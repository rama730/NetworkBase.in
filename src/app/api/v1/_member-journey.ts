import { sql } from "drizzle-orm";

import { jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import type { ApiErrorCode } from "@/app/api/v1/_envelope";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { validateCsrf } from "@/lib/security/csrf";
import { isLooseUuid } from "@/lib/validations/uuid";
import { MemberJourneyError } from "@/lib/workspaces/member-journey";

/**
 * Shared by the member settings routes (/workspaces/:id/me…, member completion): your own sign-in for changes, never
 * an agent token (member settings §1.7); reading your part is allowed to any of your sign-ins, agents included.
 */
export async function signedIn(request: Request, context: { params: Promise<{ id: string }> }, opts: { csrf: boolean }) {
    if (opts.csrf) { // a change: CSRF here, and your own sign-in below
        const csrf = validateCsrf(request);
        if (csrf) return { response: csrf, user: null, auth: null, id: "" };
    }
    const auth = await requireAuthenticatedUser();
    if (auth.response) return { response: auth.response, user: null, auth: null, id: "" };
    if (!auth.user) return { response: jsonError("Sign in to continue", 401, "UNAUTHORIZED"), user: null, auth: null, id: "" };
    if (opts.csrf && auth.tokenKind && auth.tokenKind !== "device") {
        return { response: jsonError("This needs your own sign-in (nb login), not a token or an agent", 403, "FORBIDDEN"), user: null, auth: null, id: "" };
    }
    const { id } = await context.params;
    if (!isLooseUuid(id)) return { response: jsonError("Which workspace?", 400, "BAD_REQUEST"), user: null, auth: null, id: "" };
    if (auth.tokenWorkspaceId && auth.tokenWorkspaceId !== id) return { response: jsonError("This sign-in is for another workspace", 403, "WORKSPACE_NOT_ALLOWED"), user: null, auth: null, id: "" };
    return { response: null, user: auth.user, auth, id };
}

export async function idOfUsername(username: string | undefined | null) {
    if (!username) return null;
    const [p] = await db.select({ id: profiles.id }).from(profiles).where(sql`lower(${profiles.username}) = lower(${username.replace(/^@/, "")})`).limit(1);
    return p?.id ?? null;
}

const STATUS: Record<MemberJourneyError["code"], number> = { FORBIDDEN: 403, NOT_FOUND: 404, BAD_REQUEST: 400, CONFLICT: 409, RATE_LIMITED: 429, MEMBER_COMPLETED: 403 };

/** A member-journey refusal as the API's error; anything else is rethrown for the route's generic handler. */
export function journeyError(error: unknown) {
    if (error instanceof MemberJourneyError) return jsonError(error.message, STATUS[error.code], error.code as ApiErrorCode);
    if (error instanceof Error && /MEMBER_COMPLETED/.test(error.message)) return jsonError("This person has completed their part here, so they can't be given new tasks", 403, "MEMBER_COMPLETED");
    throw error;
}
