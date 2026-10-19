import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredAssets = [
  "favicon.ico",
  "favicon.svg",
  "apple-touch-icon.png",
  "icon-paper.svg",
  "icon-paper.ico",
  "icon-paper-32.png",
  "icon-paper-tab.svg",
  "icon-paper-tab.ico",
  "icon-paper-tab-32.png",
  "icon-paper-64.png",
  "icon-paper-180.png",
  "icon-paper-192.png",
  "icon-paper-512.png",
  "icon-paper-maskable-192.png",
  "icon-paper-maskable-512.png",
  "icon-paper-mono.svg",
] as const;

const missing = requiredAssets.filter((asset) => !existsSync(path.join(root, "public", asset)));
if (missing.length) {
  throw new Error(`Missing required NetworkBase brand assets: ${missing.join(", ")}`);
}

const manifestPath = path.join(root, "public", "manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  name?: string;
  background_color?: string;
  theme_color?: string;
  icons?: Array<{ src?: string; purpose?: string }>;
};

if (manifest.name !== "NetworkBase") throw new Error("Manifest name must remain NetworkBase.");
if (manifest.background_color !== "#141A1E" || manifest.theme_color !== "#141A1E") {
  throw new Error("Manifest must use the approved Ink install surface colours.");
}
const icons = manifest.icons ?? [];
for (const expected of ["/icon-paper-192.png", "/icon-paper-512.png", "/icon-paper-maskable-192.png", "/icon-paper-maskable-512.png"]) {
  if (!icons.some((icon) => icon.src === expected)) throw new Error(`Manifest is missing ${expected}.`);
}
if (!icons.some((icon) => icon.src === "/icon-paper-maskable-512.png" && icon.purpose === "maskable")) {
  throw new Error("Maskable 512px icon must retain purpose=maskable.");
}

const pngSizes: Record<string, number> = {
  "apple-touch-icon.png": 180,
  "icon-paper-32.png": 32,
  "icon-paper-tab-32.png": 32,
  "icon-paper-64.png": 64,
  "icon-paper-180.png": 180,
  "icon-paper-192.png": 192,
  "icon-paper-512.png": 512,
  "icon-paper-maskable-192.png": 192,
  "icon-paper-maskable-512.png": 512,
};

function readPngSize(filePath: string): { width: number; height: number } {
  const input = readFileSync(filePath);
  const signature = "89504e470d0a1a0a";
  if (input.subarray(0, 8).toString("hex") !== signature) throw new Error(`${filePath} is not a PNG.`);
  return { width: input.readUInt32BE(16), height: input.readUInt32BE(20) };
}

for (const [asset, expected] of Object.entries(pngSizes)) {
  const dimensions = readPngSize(path.join(root, "public", asset));
  if (dimensions.width !== expected || dimensions.height !== expected) {
    throw new Error(`${asset} must remain an optically-corrected ${expected}×${expected} square.`);
  }
}

const globals = readFileSync(path.join(root, "src", "app", "globals.css"), "utf8");
for (const selector of [
  ".nb-brand-mark", ".nb-brand-dot", ".nb-brand-name",
  ".nb-sidebar-brand .nb-brand-mark--lockup { gap:calc(var(--nb-brand-dot-size) * .55); }",
]) {
  if (!globals.includes(selector)) throw new Error(`Brand CSS contract is missing ${selector}.`);
}

const layout = readFileSync(path.join(root, "src", "app", "root-document.tsx"), "utf8");
if (!layout.includes('themeColor: "#141A1E"')) {
  throw new Error("Browser chrome must use the approved fixed Ink brand field.");
}

const mark = readFileSync(path.join(root, "src", "components", "brand", "BrandMark.tsx"), "utf8");
for (const fragment of ["Math.round(dot * 0.55)", "ground === \"image\" ? \"ink\" : tone", "gap: `${gap}px`"]) {
  if (!mark.includes(fragment)) throw new Error(`Canonical wordmark behaviour is missing ${fragment}.`);
}

const sidebar = readFileSync(path.join(root, "src", "components", "layout", "AppSidebar.tsx"), "utf8");
for (const fragment of [
  "href={ROUTES.DISCOVER}",
  '<BrandMark variant="dot" size={19} label="NetworkBase" />',
  "<BrandMark size={19} />",
]) {
  if (!sidebar.includes(fragment)) throw new Error(`Sidebar static-brand contract is missing ${fragment}.`);
}
for (const fragment of ["DotLoader", "WordmarkLoadIndicator", "SIDEBAR_BRAND_LOAD_MS", "SidebarBrand"]) {
  if (sidebar.includes(fragment)) throw new Error(`Sidebar must not animate the brand: found ${fragment}.`);
}

console.log(`Brand system contract passed (${requiredAssets.length} assets, geometry, manifest, wordmark).`);
