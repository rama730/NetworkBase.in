// Players keep re-requesting ranges from the redirected URL while seeking; a
// 5-minute URL would 403 mid-video. Long media gets 2 hours, everything else 5 minutes.
export const SIGNED_URL_SECONDS = 300;
export const MEDIA_SIGNED_URL_SECONDS = 2 * 60 * 60;

export function signedUrlSeconds(mime: string | null | undefined) {
  return /^(video|audio)\//.test(mime ?? "") ? MEDIA_SIGNED_URL_SECONDS : SIGNED_URL_SECONDS;
}
