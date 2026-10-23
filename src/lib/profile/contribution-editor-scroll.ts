/** Scroll only the editor pane; scrollIntoView would also move overflow-hidden shell ancestors. */
export function scrollContributionEditorTarget(
  target: HTMLElement | null,
  focus = false,
) {
  if (!target) return;
  const root = target.closest<HTMLElement>('[data-scroll-root="route"]');
  if (focus) target.focus({ preventScroll: true });
  if (!root) return;
  root.scrollTo({
    top: Math.max(
      0,
      root.scrollTop +
        target.getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        20,
    ),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
}
