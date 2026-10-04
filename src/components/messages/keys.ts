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

/** Escape belongs to an open dialog, confirm, menu or popover (or was already handled). */
export function escapeTaken(event: KeyboardEvent) {
  return event.defaultPrevented || Boolean(document.querySelector("[role=dialog],[role=alertdialog],[role=menu],[role=listbox]"));
}
