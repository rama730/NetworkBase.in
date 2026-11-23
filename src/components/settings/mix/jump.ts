/** Go to a setting on the Settings page: the layout scrolls to it, focuses its section and tints it. */
export function jumpToSetting(id: string) {
  if (window.location.hash === `#${id}`) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else window.location.hash = id;
}
