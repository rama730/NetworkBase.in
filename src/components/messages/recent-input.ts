// Motion on interaction only: a surface animates its entrance when a click or key just opened it,
// not on a page load, a refresh or a remount.
let lastInputAt = 0;
if (typeof window !== "undefined") {
  const mark = () => { lastInputAt = Date.now(); };
  window.addEventListener("pointerdown", mark, true);
  window.addEventListener("keydown", mark, true);
}

/** True within a second of the last pointer or key input. */
export function recentInput() {
  return Date.now() - lastInputAt < 1000;
}
