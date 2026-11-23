/** Go to a setting on the Settings page: the layout scrolls to it, focuses its section and tints it. */
export function jumpToSetting(id: string) {
  if (window.location.hash === `#${id}`) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else window.location.hash = id;
}

/** Jump to a setting and ask it to open something (a setup dialog, a form): it listens for "nbs:open". */
export function openSetting(id: string, what: string) {
  jumpToSetting(id);
  window.setTimeout(() => window.dispatchEvent(new CustomEvent("nbs:open", { detail: what })), 350);
}
