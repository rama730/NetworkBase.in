/** Preview budgets are independent: long text must not push the image glimpse away. */
export function contributionPreviewLayout({
  summaryHeight,
  lineHeight,
  detailsHeight,
  hasMedia,
}: {
  summaryHeight: number;
  lineHeight: number;
  detailsHeight: number;
  hasMedia: boolean;
}) {
  const summaryLimit = 3 * lineHeight;
  const detailsLimit = hasMedia
    ? 88
    : Math.max(
        0,
        192 -
          Math.min(summaryHeight, summaryLimit) -
          (summaryHeight && detailsHeight ? 12 : 0),
      );
  return {
    summaryLimit,
    detailsLimit,
    summaryClipped: summaryHeight > summaryLimit + 1,
    detailsClipped: detailsHeight > detailsLimit + 1,
  };
}

/** Plain, fully readable preview text for assistive technology when a visual block is clipped.
 * Range measures the rendered Markdown, including wrapped lists and emphasized text.
 */
export function contributionPreviewText(
  element: HTMLElement | null,
  height: number,
): string {
  if (!element || height <= 0) return "";
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  const bottom = element.getBoundingClientRect().top + height;
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node.textContent ?? "";
    if (!value.trim()) continue;
    range.selectNodeContents(node);
    if (range.getBoundingClientRect().bottom <= bottom + 1) {
      parts.push(value);
      continue;
    }
    let low = 0,
      high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      range.setStart(node, 0);
      range.setEnd(node, middle);
      if (range.getBoundingClientRect().bottom <= bottom + 1) low = middle;
      else high = middle - 1;
    }
    const prefix = value.slice(0, low);
    // End at a word boundary rather than reading out a clipped fragment.
    parts.push(
      /\S/.test(value[low] ?? "") ? prefix.replace(/\S+$/, "") : prefix,
    );
    break;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Keep collapse inside the route scroller; focusing must not move shell ancestors. */
export function restoreContributionPreviewPosition(
  anchor: HTMLElement | null,
  button: HTMLButtonElement | null,
) {
  (button ?? anchor)?.focus({ preventScroll: true });
  const root = anchor?.closest<HTMLElement>('[data-scroll-root="route"]');
  if (!anchor || !root) return;
  const top = anchor.getBoundingClientRect().top;
  const viewport = root.getBoundingClientRect();
  if (top < viewport.top || top >= viewport.bottom) {
    root.scrollTo({
      top: Math.max(0, root.scrollTop + top - viewport.top - 16),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
}
