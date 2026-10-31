type VisibilityDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/**
 * Calls `onDone` once the page has been visible for `ms` in total: a background tab waits until someone looks at it.
 * Returns a function that cancels it.
 */
export function startVisibleDwell(ms: number, onDone: () => void, doc: VisibilityDocument = document): () => void {
  let remaining = ms;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    remaining -= Date.now() - startedAt;
  };
  const stop = () => {
    pause();
    doc.removeEventListener("visibilitychange", onChange);
  };
  const resume = () => {
    if (timer) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      stop();
      onDone();
    }, remaining);
  };
  function onChange() {
    if (doc.visibilityState === "visible") resume();
    else pause();
  }

  doc.addEventListener("visibilitychange", onChange);
  onChange();
  return stop;
}
