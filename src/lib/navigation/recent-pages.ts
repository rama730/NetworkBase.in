// The last few pages this tab visited, for "Recently visited" on a 404. Built from the page each history entry was opened
// from (in-app-history's `from`), kept in sessionStorage so it lives and dies with the tab.

export type RecentPage = { path: string; title: string };

const KEY = "nb_recent_pages";
const MAX = 5;
const SKIP = /^\/(login|signup|join|device|authorize|forgot-password|reset-password|verify-email|onboarding)(\/|$)/;

/** Newest first, each page once, at most five; sign-in pages and pages without a title are left out. */
export function pushRecentPage(list: RecentPage[], page: RecentPage): RecentPage[] {
  if (!page.title.trim() || SKIP.test(page.path)) return list;
  return [page, ...list.filter((p) => p.path !== page.path)].slice(0, MAX);
}

export function rememberRecentPage(page: RecentPage) {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as RecentPage[];
    const next = pushRecentPage(Array.isArray(list) ? list : [], page);
    if (next !== list) sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked; the 404 then just has no list.
  }
}

export function readRecentPages(exceptPath: string, limit = 3): RecentPage[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as RecentPage[];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.path === "string" && typeof p.title === "string" && p.path !== exceptPath).slice(0, limit) : [];
  } catch {
    return [];
  }
}
