// A plain left click is the app's own navigation; anything else (Cmd/Ctrl/Shift/Alt-click, middle
// click) is left to the browser, so real links open in a new tab as people expect (unified back B15).
export function isPlainLeftClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
