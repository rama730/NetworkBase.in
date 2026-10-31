// Players keep re-requesting ranges from the redirected URL while seeking; a 5-minute URL would 403 mid-video.
// Media gets 30 minutes (a player that outlasts it reauthorizes through attachmentRetryUrl), everything else 5.
export const SIGNED_URL_SECONDS = 300;
export const MEDIA_SIGNED_URL_SECONDS = 30 * 60;

export function signedUrlSeconds(mime: string | null | undefined) {
  return /^(video|audio)\//.test(mime ?? "") ? MEDIA_SIGNED_URL_SECONDS : SIGNED_URL_SECONDS;
}

/** Reauthorize once through the stable endpoint, rather than retrying an expired storage token. */
export function attachmentRetryUrl(url: string, attempt: number, stamp = Date.now()): string | null {
  if (attempt !== 0 || !/^\/api\/v1\/chat\/attachments\/[0-9a-f-]{36}(?:\?|$)/i.test(url)) return null;
  const parsed = new URL(url, "https://attachment.test");
  parsed.searchParams.set("_reauth", String(stamp));
  return parsed.pathname + parsed.search;
}
