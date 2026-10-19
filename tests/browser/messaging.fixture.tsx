import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { usePanes } from "../../src/components/messages/usePanes";
import { useDocumentTitlePrefix } from "../../src/hooks/useDocumentTitlePrefix";
import ResolvedVideoPlayer from "../../src/components/messages/parts/resolved-video-player";
import { storedFailedSends, clearFailedSends } from "../../src/components/messages/failed-sends";
import { evictCachedTimelines } from "../../src/lib/messaging/storage-cache";
import { normalizeSafeExternalUrl } from "../../src/lib/messaging/safe-links";
import { uploadChatFile } from "../../src/components/messages/upload";
import { metadata as messagingMetadata } from "../../src/app/(site)/(main)/messages/layout";
import { generateMetadata as conversationMetadata } from "../../src/app/(site)/(main)/messages/[channelId]/page";
import { generateMetadata as projectMetadata } from "../../src/app/(site)/(main)/messages/(lists)/p/[projectId]/page";
import { generateMetadata as browseMetadata } from "../../src/app/(site)/(main)/messages/(lists)/p/[projectId]/browse/page";
import { generateMetadata as homeMetadata } from "../../src/app/(site)/(main)/messages/(lists)/page";
import { generateMetadata as inboxMetadata } from "../../src/app/(site)/(main)/messages/(lists)/inbox/page";
import { generateMetadata as savedMetadata } from "../../src/app/(site)/(main)/messages/(lists)/saved/page";
import { generateMetadata as draftsMetadata } from "../../src/app/(site)/(main)/messages/(lists)/drafts/page";
import { generateMetadata as searchMetadata } from "../../src/app/(site)/(main)/messages/(lists)/search/page";
import { generateMetadata as newMetadata } from "../../src/app/(site)/(main)/messages/(lists)/new/page";

const id = "11111111-1111-4111-8111-111111111111";
const subscribe = (callback: () => void) => { window.addEventListener("fixture-navigation", callback); return () => window.removeEventListener("fixture-navigation", callback); };
const snapshot = () => location.pathname + location.search;
const navigate = (href: string) => window.history.pushState({}, "", href);

async function routeHead(path: string) {
  const base = path.split("?")[0]!;
  const lists = { "/messages": homeMetadata, "/messages/inbox": inboxMetadata, "/messages/saved": savedMetadata, "/messages/drafts": draftsMetadata, "/messages/search": searchMetadata, "/messages/new": newMetadata };
  const metadata = base in lists ? lists[base as keyof typeof lists]()
    : base.endsWith("/browse") ? await browseMetadata({ params: Promise.resolve({ projectId: id }) })
      : base.includes("/p/") ? await projectMetadata({ params: Promise.resolve({ projectId: id }) })
        : await conversationMetadata({ params: Promise.resolve({ channelId: id }) });
  return { ...metadata, robots: messagingMetadata.robots };
}

function Fixture() {
  const path = useSyncExternalStore(subscribe, snapshot);
  const panes = usePanes(id);
  const [prefix, setPrefix] = useState<string | null>("Design");
  const [badge, setBadge] = useState<string | null>("(3)");
  const [windowOnly, setWindowOnly] = useState(false);
  const [player, setPlayer] = useState(false);
  useDocumentTitlePrefix(windowOnly ? null : prefix);
  useDocumentTitlePrefix(badge, " ");
  useEffect(() => { let live = true; void routeHead(path).then((metadata) => {
    if (!live) return;
    document.title = String(metadata.title);
    document.querySelectorAll('link[rel="canonical"], meta[name="robots"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
    const canonical = document.createElement("link"); canonical.rel = "canonical"; canonical.href = new URL(String(metadata.alternates?.canonical), location.origin).href; document.head.append(canonical);
    for (const [attr, key, value] of [["name", "robots", "noindex, nofollow"], ["property", "og:title", (metadata.openGraph as any)?.title], ["property", "og:url", canonical.href], ["name", "twitter:title", (metadata.twitter as any)?.title]]) {
      const tag = document.createElement("meta"); tag.setAttribute(String(attr), String(key)); tag.content = String(value); document.head.append(tag);
    }
  }); return () => { live = false; }; }, [path]);
  useEffect(() => {
    (window as any).messagingFixture = { navigate, setPrefix, setBadge, setWindowOnly, setPlayer, normalizeSafeExternalUrl, storedFailedSends, clearFailedSends, evictCachedTimelines, upload: (name: string) => uploadChatFile(id, new File([new Uint8Array(300000)], name, { type: "image/png" })) };
  }, []);
  return <main>
    <output data-testid="state">{JSON.stringify(panes, (_key, value) => typeof value === "function" ? undefined : value)}</output>
    <button onClick={() => panes.openThread(12)}>Open thread</button>
    <button onClick={() => panes.openDetails("members")}>Open details</button>
    <button onClick={() => panes.selectPane("thread")}>Show thread</button>
    <button onClick={() => panes.closeThread()}>Close thread</button>
    <button onClick={() => panes.closeDetails()}>Close details</button>
    {player ? <ResolvedVideoPlayer url={`/api/v1/chat/attachments/${id}`} controls initialTime={12} /> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
