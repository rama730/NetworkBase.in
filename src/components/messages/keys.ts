import { useSyncExternalStore } from "react";

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_NAMES: Record<string, [mac: string, other: string]> = {
  mod: ["⌘", "Ctrl"], ctrl: ["⌃", "Ctrl"], shift: ["⇧", "Shift"], alt: ["⌥", "Alt"],
  enter: ["↵", "Enter"], backspace: ["⌫", "Backspace"], esc: ["Esc", "Esc"], up: ["↑", "↑"], down: ["↓", "↓"],
};

/** One way to write keys everywhere: "mod+shift+k" → "⌘⇧K" on a Mac, "Ctrl+Shift+K" elsewhere. */
export function keyLabel(combo: string) {
  const mac = isMac();
  const parts = combo.split("+").map((part) => KEY_NAMES[part.toLowerCase()]?.[mac ? 0 : 1] ?? part.toUpperCase());
  return parts.join(mac ? "" : "+");
}

const noSubscribe = () => () => undefined;

/**
 * "⌘K" or "Ctrl+K" for mod plus `key`. The server can't know the platform, so it always writes the Mac form and the
 * browser swaps in its own after hydrating; reading the platform while rendering made React error #418 on every page.
 */
export function useModKeyHint(key: string) {
  return useSyncExternalStore(noSubscribe, () => keyLabel(`mod+${key}`), () => `⌘${key.toUpperCase()}`);
}

/** Conversation details: ⌘⇧I on a Mac, Ctrl+Alt+I elsewhere (Ctrl+Shift+I is the browser's DevTools). */
export const detailsKeys = () => (isMac() ? "mod+shift+i" : "ctrl+alt+i");
export function isDetailsKey(event: KeyboardEvent) {
  if (event.code !== "KeyI" && event.key.toLowerCase() !== "i") return false;
  return isMac() ? event.metaKey && event.shiftKey : event.ctrlKey && event.altKey && !event.shiftKey;
}

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
