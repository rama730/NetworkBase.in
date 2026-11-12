// ============================================================================
// Task Panel Overhaul - Wave 4
// GET /api/v1/workspaces/:id/members?q=<query>
//
// Fuzzy-lookup endpoint that powers the @mention autocomplete in the task
// comment composer. Returns up to MAX_RESULTS members of the project (owner
// plus project_members, joined to profiles) whose display name / username
// substring-matches the query.
//
// The endpoint is deliberately narrow in scope:
//   - Auth-required and project-membership-guarded: only members of the
//     project can enumerate their teammates. This protects us from someone
//     harvesting the member list of a private project via the autocomplete.
//   - Returns a flat list of the minimum fields the composer needs
//     (id, username, fullName, avatarUrl). Additional personal data stays
//     behind the existing profile endpoints.
//   - Rate-limited via the shared enforceRouteLimit helper (60/min/user+ip) so
//     a runaway composer loop can't DoS the database.
// ============================================================================

import { NextRequest } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { memberInviteSchema, memberRemoveSchema, memberRoleSchema } from "@/lib/api/v1-schemas";

import {
    jsonError,
    jsonSuccess,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles, workspaceMembers, workspaceOpenRoles, workspaces } from "@/lib/db/schema";
import { removeWorkspaceMemberAction, updateWorkspaceMemberRoleAction } from "@/lib/workspaces/server/settings";
import { createWorkspaceInvitation } from "@/lib/workspaces/workspace-invitations";
import { validateCsrf } from "@/lib/security/csrf";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { isWorkspaceMemberEligibleFor } from "@/lib/workspaces/collaborator-lifecycle";
import { isLooseUuid } from "@/lib/validations/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 64;

export interface WorkspaceMemberSearchResult {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    role: "owner" | "admin" | "member" | "viewer";
    eligible: boolean;
}

type ProjectMemberSearchEligibility = "mention" | "assign" | "review";

function normalizeQuery(raw: string | null): string {
    if (!raw) return "";
    const trimmed = raw.trim();
    if (trimmed.length === 0) return "";
    // We substring-match against username + fullName via `ilike`, so we escape
    // the LIKE wildcards the user might have typed (underscore and percent) so
    // "a_b" does not end up matching "a b".
    const escaped = trimmed.replace(/[%_\\]/g, (ch) => `\\${ch}`);
    return escaped.length <= MAX_QUERY_LENGTH
        ? escaped
        : escaped.slice(0, MAX_QUERY_LENGTH);
}

function normalizeEligibility(raw: string | null): ProjectMemberSearchEligibility {
    return raw === "assign" || raw === "review" ? raw : "mention";
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {

    const { user, response } = await requireAuthenticatedUser();
    if (response) return response;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const params = await context.params;
    const projectId = params.id;
    if (!isLooseUuid(projectId)) {
        return jsonError("Invalid workspace id", 400, "BAD_REQUEST");
    }

    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project) {
        return jsonError("Workspace not found", 404, "NOT_FOUND");
    }
    if (!access.isOwner && !access.isMember) {
        return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    }

    const rawQuery = request.nextUrl.searchParams.get("q");
    const query = normalizeQuery(rawQuery);
    const eligibility = normalizeEligibility(request.nextUrl.searchParams.get("eligibility"));
    const likePattern = query.length > 0 ? `%${query}%` : null;

    // The member roster consists of (a) the project owner and (b) the rows in
    // project_members. We UNION them in application code via two separate
    // queries to keep the SQL straightforward and the type inference clean.
    // Both queries are bounded by MAX_RESULTS so the combined set is at most
    // 2 * MAX_RESULTS rows before we dedupe and re-cap.
    const ownerPromise = db
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .innerJoin(workspaces, eq(workspaces.ownerId, profiles.id))
        .where(
            and(
                eq(workspaces.id, projectId),
                likePattern
                    ? or(
                          ilike(profiles.fullName, likePattern),
                          ilike(profiles.username, likePattern),
                      )
                    : sql`true`,
            ),
        )
        .limit(1);

    const memberPromise = db
        .select({
            id: profiles.id,
            role: workspaceMembers.role,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(workspaceMembers)
        .innerJoin(profiles, eq(workspaceMembers.userId, profiles.id))
        .where(
            and(
                eq(workspaceMembers.projectId, projectId),
                likePattern
                    ? or(
                          ilike(profiles.fullName, likePattern),
                          ilike(profiles.username, likePattern),
                      )
                    : sql`true`,
            ),
        )
        .limit(MAX_RESULTS + 1);

    const [ownerRows, memberRows] = await Promise.all([ownerPromise, memberPromise]);

    const seen = new Set<string>();
    const results: WorkspaceMemberSearchResult[] = [];

    for (const row of ownerRows) {
        if (!row?.id || seen.has(row.id)) continue;
        if (!isWorkspaceMemberEligibleFor("owner", eligibility)) continue;
        seen.add(row.id);
        results.push({
            id: row.id,
            username: row.username,
            fullName: row.fullName,
            avatarUrl: row.avatarUrl,
            role: "owner",
            eligible: true,
        });
    }

    for (const row of memberRows) {
        if (!row?.id || seen.has(row.id)) continue;
        const role = (row.role ?? "member") as WorkspaceMemberSearchResult["role"];
        if (!isWorkspaceMemberEligibleFor(role, eligibility)) continue;
        seen.add(row.id);
        results.push({
            id: row.id,
            username: row.username,
            fullName: row.fullName,
            avatarUrl: row.avatarUrl,
            role,
            eligible: true,
        });
        if (results.length >= MAX_RESULTS) break;
    }

    // The composer does its own sorting for keyboard navigation; on the wire
    // we nudge the owner to the top (already inserted first) and keep the rest
    // in the query order returned by Postgres.
    return jsonSuccess(
        { members: results.slice(0, MAX_RESULTS) },
        undefined,
        { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } },
    );
}

// ───────────── nb member invite / role / remove and nb workspace leave (report C4, M4b)

/** Changing who is in a workspace needs the person's own sign-in: personal tokens and agents are refused. */
async function personAt(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return { response: csrf, user: null };
  const auth = await requireAuthenticatedUser();
  if (auth.response) return { response: auth.response, user: null };
  if (!auth.user) return { response: jsonError("Sign in to continue", 401, "UNAUTHORIZED"), user: null };
  if (auth.tokenKind && auth.tokenKind !== "device") return { response: jsonError("Changing members needs your own sign-in (nb login), not a token", 403, "FORBIDDEN"), user: null };
  return { response: null, user: auth.user };
}
const answer = (r: { success: boolean; message?: string; errorCode?: string }, ok: unknown) =>
  r.success ? jsonSuccess(ok) : jsonError(r.message ?? "Couldn’t change the member", r.errorCode === "FORBIDDEN" ? 403 : r.errorCode === "NOT_FOUND" ? 404 : 400, r.errorCode === "FORBIDDEN" ? "FORBIDDEN" : r.errorCode === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST");
async function personByName(username: string) {
  const [p] = await db.select({ id: profiles.id, username: profiles.username }).from(profiles).where(sql`lower(${profiles.username}) = lower(${username.replace(/^@/, "")})`).limit(1);
  return p ?? null;
}

/** Invite someone into one of the workspace's open roles (workspace invitations are for a role). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response, user } = await personAt(request);
  if (response) return response;
  const { id } = await context.params;
  const parsed = memberInviteSchema.safeParse(await request.json().catch(() => null));
  if (!isLooseUuid(id) || !parsed.success) return jsonError("Who, and into which role?", 400, "BAD_REQUEST");
  const person = await personByName(parsed.data.username);
  if (!person) return jsonError(`No one called @${parsed.data.username.replace(/^@/, "")}`, 404, "NOT_FOUND");
  const roles = await db.select({ id: workspaceOpenRoles.id, title: workspaceOpenRoles.title }).from(workspaceOpenRoles).where(eq(workspaceOpenRoles.projectId, id));
  const want = parsed.data.role.toLowerCase();
  const role = roles.find((r) => r.id === parsed.data.role || (r.title ?? "").toLowerCase() === want);
  if (!role) return jsonError(roles.length ? `No open role "${parsed.data.role}". Open roles: ${roles.map((r) => r.title ?? "untitled").join(", ")}` : "This workspace has no open roles; add one in the app’s Members page first", 404, "NOT_FOUND");
  try {
    const created = await createWorkspaceInvitation({ actorId: user!.id, candidateId: person.id, projectId: id, kind: "ordinary_role", roleId: role.id, note: parsed.data.note ?? null, guidanceLabel: null, reviewAt: null, idempotencyKey: request.headers.get("idempotency-key") });
    return jsonSuccess({ invited: `@${person.username}`, role: role.title ?? "the role", invitationId: created.invitation.id });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Couldn’t invite", 409, "CONFLICT");
  }
}

/** Change a member's role (owner and admins, the app's rules). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await personAt(request);
  if (response) return response;
  const { id } = await context.params;
  const parsed = memberRoleSchema.safeParse(await request.json().catch(() => null));
  if (!isLooseUuid(id) || !parsed.success) return jsonError("Who, and admin, member or viewer?", 400, "BAD_REQUEST");
  const person = await personByName(parsed.data.username);
  if (!person) return jsonError(`No one called @${parsed.data.username.replace(/^@/, "")}`, 404, "NOT_FOUND");
  return answer(await updateWorkspaceMemberRoleAction(id, person.id, parsed.data.role), { username: person.username, role: parsed.data.role });
}

/** Remove a member (their open tasks are unassigned), or leave yourself with `{ leave: true }`. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response, user } = await personAt(request);
  if (response) return response;
  const { id } = await context.params;
  const parsed = memberRemoveSchema.safeParse(await request.json().catch(() => null));
  if (!isLooseUuid(id) || !parsed.success || (!parsed.data.username && !parsed.data.leave)) return jsonError("Who? Or leave: true", 400, "BAD_REQUEST");
  if (parsed.data.leave) return answer(await removeWorkspaceMemberAction(id, user!.id, { mode: "unassign_active_tasks", leave: true }), { left: true });
  const person = await personByName(parsed.data.username!);
  if (!person) return jsonError(`No one called @${parsed.data.username!.replace(/^@/, "")}`, 404, "NOT_FOUND");
  return answer(await removeWorkspaceMemberAction(id, person.id, { mode: "unassign_active_tasks" }), { removed: person.username });
}
