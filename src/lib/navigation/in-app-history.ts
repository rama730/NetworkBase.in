// How many in-app pages sit behind this one in the tab's history, so "Back" never
// leaves the site from a deep link. MainLayout reports every pathname change;
// a browser back/forward (popstate) counts as one step back.
// ponytail: Forward also counts as a step back (popstate can't tell them apart), and a
// router.replace to a new path counts as a step forward. ceiling: after those, in-app Back
// may use the fallback or step back once too far. upgrade: per-entry ids in history.state.

let depth = 0;
let current: string | null = null;
/** Where the last browser back/forward landed; a pop that only changed the query never matches a new path. */
let poppedTo: string | null = null;

if (typeof window !== "undefined") window.addEventListener("popstate", () => { poppedTo = window.location.pathname; });

/** Call on every pathname change; repeats of the same path (effects re-running) are ignored. */
export function noteNavigation(pathname: string) {
  if (pathname === current) return;
  const first = current === null;
  current = pathname;
  if (first) return;
  depth = Math.max(0, depth + (pathname === poppedTo ? -1 : 1));
  poppedTo = null;
}

export function canGoBackInApp() {
  return depth > 0;
}

/** Tests only. */
export function resetInAppHistory() {
  depth = 0;
  current = null;
  poppedTo = null;
}

/** Tests only: simulate a browser back/forward landing on `pathname`. */
export function notePop(pathname: string) {
  poppedTo = pathname;
}
