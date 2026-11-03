import { cookies } from "next/headers";

// Preview as member (report §45.6, decision 175): an owner or admin sees an organization through the member read
// rules. Nobody signs in as anyone else; the cookie only lowers the viewer's own role there, and writes are refused.

export const MEMBER_PREVIEW_COOKIE = "nb_member_preview";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The organization being previewed, or null. Outside a request (jobs, scripts) there is never a preview. */
export async function memberPreviewOrgId(): Promise<string | null> {
  try {
    const value = (await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value;
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}
