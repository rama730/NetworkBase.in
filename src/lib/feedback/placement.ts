export type ToastPlace = 'modal' | 'phone' | 'pane' | 'window' | 'corner';

/** Where the stack sits (Toasts board): near what it is about, in this order. */
export function toastPlace(at: { dialog: boolean; mobile: boolean; pane: boolean; window: boolean }): ToastPlace {
  if (at.dialog) return 'modal';
  if (at.mobile) return 'phone';
  if (at.pane) return 'pane';
  return at.window ? 'window' : 'corner';
}

/** Bottom-right: left of the 400 px floating window, above the 56 px launcher, else 24 px in. */
export function cornerOffsets(at: { window: boolean; launcher: boolean }) {
  if (at.window) return { right: 24 + 400 + 12, bottom: 24 };
  return { right: 24, bottom: at.launcher ? 24 + 56 + 12 : 24 };
}
