export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A tablist's ←/→/Home/End: the index to move to, or null for any other key (which then does nothing). */
export function rovingTabKey(event: React.KeyboardEvent, index: number, count: number) {
  const next = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count
    : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
  if (next !== null) event.preventDefault();
  return next;
}

/** Is focus in a text field? Global chat shortcuts then leave the key to the editor. */
export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"));
}

/** Has the focused editor got unsent text? Then Escape must not throw it away. */
export function editingWithText(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return Boolean(el.textContent?.trim());
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return Boolean((el as HTMLInputElement).value.trim());
  return false;
}

/**
 * Escape belongs to an open dialog, confirm, menu or popover (or was already handled).
 * The chat drawer is a dialog on mobile but closes on Escape itself, so it doesn't count.
 */
export function escapeTaken(event: KeyboardEvent) {
  return event.defaultPrevented || Boolean(document.querySelector("[role=dialog]:not([data-chat-pane]),[role=alertdialog],[role=menu],[role=listbox]"));
}
