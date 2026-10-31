import type { createAdminClient } from "@/lib/supabase/server";

// Long enough for the browser to follow the redirect; the transfer may run past it.
const DOWNLOAD_LINK_SECONDS = 60;

/**
 * Sends a download straight from storage with its real filename. The bytes skip the app server, so a large file
 * on a slow connection isn't cut off, and the browser can show progress and resume. Null when signing fails.
 */
export async function signedDownloadRedirect(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  input: { bucket: string; storageKey: string; filename: string },
) {
  const { data, error } = await admin.storage.from(input.bucket).createSignedUrl(input.storageKey, DOWNLOAD_LINK_SECONDS);
  if (error || !data?.signedUrl) return null;
  // Not the library's `download` option: it adds the name unencoded, so `R&D #1.pdf` would save as `R`.
  return new Response(null, {
    status: 302,
    headers: { Location: `${data.signedUrl}&download=${encodeURIComponent(input.filename)}`, "Cache-Control": "private, no-store" },
  });
}
