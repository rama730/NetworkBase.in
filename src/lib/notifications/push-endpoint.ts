/**
 * Web Push endpoints are chosen by the browser from its push service, never by the user (COR-017).
 * Accepting any https URL would let an account register a destination of its choosing and have the
 * server call it, so only the real push providers' hosts are allowed, at save and again at send.
 */
const PUSH_PROVIDER_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Edge, Opera, Brave, Samsung Internet (FCM)
  "android.googleapis.com", // legacy Chrome endpoints
  "push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com and regional hosts)
  "push.apple.com", // Safari / WebKit (web.push.apple.com)
  "notify.windows.com", // Windows Notification Service
] as const;

/** Active devices kept per user; the least recently seen are dropped on save (PERF-005). */
export const MAX_PUSH_ENDPOINTS_PER_USER = 10;

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_PROVIDER_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
