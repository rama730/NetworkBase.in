import path from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";
let script: string;
const id = "11111111-1111-4111-8111-111111111111";
const origin = "https://networkbase.in";

test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    "next/navigation": `import {useSyncExternalStore} from 'react';
      const event = 'fixture-navigation';
      for (const method of ['pushState','replaceState']) {const original=history[method].bind(history); history[method]=(...args)=>{original(...args); window.dispatchEvent(new Event(event));};}
      window.addEventListener('popstate',()=>window.dispatchEvent(new Event(event)));
      const subscribe=fn=>{window.addEventListener(event,fn);return ()=>window.removeEventListener(event,fn);};
      export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);
      export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
      export const useRouter=()=>({push:(href)=>history.pushState({},'',href),replace:(href)=>history.replaceState({},'',href),back:()=>history.back()});
      export const redirect=()=>{}; export const notFound=()=>{};`,
    "@/components/messages/MessagesChrome": "export const MessagesChrome=()=>null;",
    "@/components/messages/MessagesSidebar": "export const MessagesSidebar=()=>null;",
    "@/components/messages/MessagesViews": "export const InboxView=()=>null; export const SavedView=()=>null; export const DraftsView=()=>null; export const SearchView=()=>null; export const WorkspaceLanding=()=>null; export const BrowseChannels=()=>null;",
    "@/components/messages/NewMessage": "export const NewMessage=()=>null;",
    "@/components/messages/MessagesIndex": "export const MessagesIndex=()=>null;",
    "@/components/messages/ListSkeleton": "export const ListSkeleton=()=>null;",
    "@/app/actions/chat/messages": "export const sendMessage=async()=>({success:false});",
    "@/app/actions/chat/members": "export const findDm=async()=>({success:false});",
    "@/lib/messaging/image-compression": "export const compressImage=async(file)=>new File([new Uint8Array(64)], file.name.replace(/\\.png$/,'.webp'), {type:'image/webp'});",
    "@/lib/upload/supabase-signed-upload-client": "export const uploadToSupabaseSignedUrl=async()=>{};",
  };
  const result = await build({ entryPoints: [path.resolve("tests/browser/messaging.fixture.tsx")], bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"test"' }, plugins: [{ name: "isolated-messaging", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: "js" }));
  } }] });
  script = result.outputFiles![0]!.text;
});

test.beforeEach(async ({ page }) => {
  await page.route(`${origin}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, body: "Expired" });
    return route.fulfill({ contentType: url.pathname === "/fixture.js" ? "application/javascript" : "text/html", body: url.pathname === "/fixture.js" ? script : '<html><head><title>Messages · NetworkBase</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
  });
  await page.goto(`${origin}/messages/${id}?tab=canvas&foo=bar`);
  await expect(page.getByTestId("state")).toBeVisible();
});

test("desktop URL state preserves tab, visible drawer, refresh and one history entry", async ({ page }) => {
  const length = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Open thread", exact: true }).click();
  await page.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(page).toHaveURL(/tab=canvas.*thread=12.*details=members.*pane=details/);
  await page.getByRole("button", { name: "Show thread", exact: true }).click();
  await expect(page).toHaveURL(/pane=thread/);
  await page.reload();
  await expect(page.getByTestId("state")).toContainText('"pane":"thread"');
  await expect(page.getByTestId("state")).toContainText('"tab":"canvas"');
  await page.getByRole("button", { name: "Close thread", exact: true }).click();
  await expect(page).toHaveURL(/tab=canvas&foo=bar&details=members$/);
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test("mobile drawer opening pushes once and closing returns to the prior URL", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = page.url();
  const length = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Open thread", exact: true }).click();
  await expect(page).toHaveURL(/thread=12/);
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  await page.getByRole("button", { name: "Open details", exact: true }).click();
  await page.getByRole("button", { name: "Close details", exact: true }).click();
  await page.getByRole("button", { name: "Close thread", exact: true }).click();
  await expect(page).toHaveURL(before);
});

test("invalid sequence parameters are removed without dropping tab state", async ({ page }) => {
  await page.evaluate(({ id }) => (window as any).messagingFixture.navigate(`/messages/${id}?m=-1&thread=Infinity&tab=canvas`), { id });
  await expect(page).toHaveURL(`${origin}/messages/${id}?tab=canvas`);
});

test("all route generators keep private social metadata and query-free canonicals", async ({ page }) => {
  const routes = ["/messages", "/messages/inbox", "/messages/saved", "/messages/drafts", "/messages/search", "/messages/new", `/messages/${id}`, `/messages/w/${id}`, `/messages/w/${id}/browse`];
  for (const route of routes) {
    await page.evaluate(href => (window as any).messagingFixture.navigate(href), `${route}?q=secret&filter=threads`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", origin + route);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", origin + route);
    await expect(page.locator('meta[property="og:title"]')).not.toHaveAttribute("content", /Design|secret/);
    await expect(page.locator('meta[name="twitter:title"]')).not.toHaveAttribute("content", /Design|secret/);
    await page.reload();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", origin + route);
  }
});

test("authorized title prefixes rename, reset and preserve unread counts; window title stays generic", async ({ page }) => {
  await expect(page).toHaveTitle(/Design.*Messages/);
  await page.evaluate(() => (window as any).messagingFixture.setPrefix("Engineering"));
  await expect(page).toHaveTitle(/Engineering.*Messages/);
  expect(await page.title()).not.toContain("Design");
  await page.evaluate(() => (window as any).messagingFixture.setPrefix(null));
  await expect(page).toHaveTitle("(3) Messages · NetworkBase");
  await page.evaluate(() => { (window as any).messagingFixture.setPrefix("Private"); (window as any).messagingFixture.setWindowOnly(true); });
  await expect(page).toHaveTitle("(3) Messages · NetworkBase");
  await page.evaluate(() => (window as any).messagingFixture.setBadge(null));
  await expect(page).toHaveTitle("Messages · NetworkBase");
});

test("media errors reauthorize once and then show an unavailable state", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/v1/chat/attachments/")) requests.push(request.url()); });
  await page.evaluate(() => (window as any).messagingFixture.setPlayer(true));
  await expect(page.getByRole("alert")).toContainText("Media unavailable");
  // WebKit may issue multiple range requests for a source; only one renewed source is allowed.
  const sources = [...new Set(requests)];
  expect(sources).toHaveLength(2);
  expect(sources[1]).toContain("_reauth=");
});

test("compressed uploads describe the representation sent to storage", async ({ page }) => {
  let body: Record<string, any> = {};
  await page.route(`${origin}/api/v1/chat/attachments/presign`, async route => {
    if (route.request().method() === "POST") body = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data: { assetId: id, uploadIntentId: id, storagePath: `${id}/image.webp`, contentType: "image/webp" } }) });
  });
  await page.evaluate(() => (window as any).messagingFixture.upload("original.png"));
  expect(body.filename).toBe("original.webp");
  expect(body.originalFilename).toBe("original.png");
  expect(body.mimeType).toBe("image/webp");
  expect(body.sizeBytes).toBe(64);
  expect(body.width).toBeNull();
  expect(body.height).toBeNull();
});

test("media reauthorization restores the playback position", async ({ page }) => {
  const waiting: import("@playwright/test").Route[] = [];
  await page.route(`${origin}/api/v1/chat/attachments/**`, route => { waiting.push(route); });
  await page.evaluate(() => (window as any).messagingFixture.setPlayer(true));
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await video.evaluate(element => {
    const media = element as HTMLVideoElement;
    let time = 37;
    Object.defineProperty(media, "currentTime", { configurable: true, get: () => time, set: value => { time = value; } });
    Object.defineProperty(media, "paused", { configurable: true, get: () => true });
    media.dispatchEvent(new Event("error"));
  });
  await expect(video).toHaveAttribute("src", /_reauth=/);
  await video.evaluate(element => { const media = element as HTMLVideoElement; media.currentTime = 0; media.dispatchEvent(new Event("loadedmetadata")); });
  expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBe(37);
  await page.goto(`${origin}/messages`);
  await Promise.all(waiting.map(route => route.abort().catch(() => undefined)));
});


test("persisted messages do not restore under another account, and legacy timelines are purged", async ({ page }) => {
  const result = await page.evaluate(({ id }) => {
    const fixture = (window as any).messagingFixture;
    const entry = { clientId: "retry", payload: { channelId: id, body: "private draft", assetIds: [], threadRootSeq: null }, message: { author_id: "account-a", body: "private draft", attachments: [], reactions: [] } };
    sessionStorage.setItem("nb_chat_failed_sends", JSON.stringify([entry, {}]));
    const mine = fixture.storedFailedSends(id, null, "account-a");
    const other = fixture.storedFailedSends(id, null, "account-b");
    sessionStorage.setItem("nb_chat_cache_one", "private messages");
    sessionStorage.setItem("nb_chat_cache_two", "private messages");
    fixture.evictCachedTimelines(sessionStorage);
    fixture.clearFailedSends();
    return { mine: mine.length, other: other.length, keys: Object.keys(sessionStorage) };
  }, { id });
  expect(result.mine).toBe(1);
  expect(result.other).toBe(0);
  expect(result.keys).not.toContain("nb_chat_failed_sends");
  expect(result.keys.some(key => key.startsWith("nb_chat_cache_"))).toBe(false);
});
