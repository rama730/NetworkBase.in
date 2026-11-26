// Which pages show the top-bar back arrow, and where it goes when nothing of ours is behind
// the page (unified back §6). Start pages are reached from the sidebar or menu, so no arrow;
// pages opened from inside another page get one.

/** Sidebar and menu destinations: starting points, no arrow. */
export const START_PATHS = ["/discover", "/network", "/messages", "/settings", "/my-profile", "/my-work", "/admin/trust"] as const;

const NO_ARROW: RegExp[] = [
  /^\/messages(\/|$)/, // Messages has its own arrow in the conversation header
  /^\/workspaces\/new$/, // Create workspace has Cancel
];

/** Detail pages and their fallback. Order matters: first match wins. */
export const DETAIL_RULES: { pattern: RegExp; fallback: string }[] = [
  { pattern: /^\/u\/[^/]+/, fallback: "/network" },
  { pattern: /^\/my-profile\/edit$/, fallback: "/my-profile" },
  { pattern: /^\/workspaces\/[^/]+/, fallback: "/discover" },
  { pattern: /^\/org\/[^/]+/, fallback: "/discover" },
  { pattern: /^\/admin\/trust\/(cases|appeals|people)\/[^/]+/, fallback: "/admin/trust" },
  { pattern: /^\/appeal\/[^/]+/, fallback: "/discover" },
  // Search results (global search mix): back returns to the page you searched from; Discover if you arrived by link.
  { pattern: /^\/search$/, fallback: "/discover" },
  // An agent's access page is opened from Settings → Integrations or an inbox item (report A8).
  { pattern: /^\/settings\/agents\/[^/]+$/, fallback: "/settings" },
];

const DEFAULT_FALLBACK = "/discover";

export function isStartPath(pathname: string) {
  return (START_PATHS as readonly string[]).includes(pathname);
}

export function backTargetFor(pathname: string): { show: boolean; fallback: string } {
  if (isStartPath(pathname) || NO_ARROW.some((rule) => rule.test(pathname))) return { show: false, fallback: DEFAULT_FALLBACK };
  const rule = DETAIL_RULES.find((r) => r.pattern.test(pathname));
  return { show: true, fallback: rule?.fallback ?? DEFAULT_FALLBACK };
}

/** "Back to Discover" when the destination is known, else "Back" (B14). */
export function backLabel(from: { title: string } | null): string {
  const name = from?.title.trim();
  return name ? `Back to ${name}` : "Back";
}

/** The most specific name in a tab title: "Tasks · Campus robotics kit · NetworkBase" → "Campus robotics kit". */
export function shortTitle(docTitle: string): string {
  const parts = docTitle
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && part !== "NetworkBase" && !/^\(\d+\+?\)$/.test(part));
  const last = parts.at(-1) ?? "";
  return last.replace(/\s*\(@[^)]+\)$/, "");
}
