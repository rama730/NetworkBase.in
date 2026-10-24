/** Shared 24px grid phase; resizing panes never changes the message scroller. */
export const HISTORY_GRID_SIZE = 24;

/** Keep narrow reading lanes quieter without changing the original cell geometry. */
export function gridStrength(width: number): number {
  return width <= 480 ? .76 : width <= 680 ? .88 : 1;
}

export function gridPhase(origin: number, edge: number): string {
  const offset = ((origin - edge) % HISTORY_GRID_SIZE + HISTORY_GRID_SIZE) % HISTORY_GRID_SIZE;
  return `${offset}px`;
}

/** Observe layout, not scrolling. Both histories align to the same page/window shell. */
export function observeHistoryGrid(history: HTMLElement): () => void {
  const origin = history.closest<HTMLElement>("[data-messages-surface]") ?? history;
  let frame: number | null = null;
  const align = () => {
    frame = null;
    const shell = origin.getBoundingClientRect();
    const pane = history.getBoundingClientRect();
    history.style.setProperty("--message-grid-width", String(gridStrength(pane.width)));
    history.style.setProperty("--message-grid-x", gridPhase(shell.left + origin.clientLeft, pane.left));
    history.style.setProperty("--message-grid-y", gridPhase(shell.top + origin.clientTop, pane.top));
  };
  const schedule = () => {
    if (frame === null) frame = window.requestAnimationFrame(align);
  };
  align();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  observer?.observe(origin);
  if (origin !== history) observer?.observe(history);
  window.addEventListener("resize", schedule);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", schedule);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}
