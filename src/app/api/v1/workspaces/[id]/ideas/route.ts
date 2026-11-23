import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { addIdeaAction, readIdeasAction } from "@/app/actions/workspace/doc";
import { agentGate } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { workspaceDocuments } from "@/lib/db/schema";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function firstIdeasDoc(id: string) {
  const [doc] = await db.select({ slug: workspaceDocuments.slug }).from(workspaceDocuments)
    .where(and(eq(workspaceDocuments.projectId, id), sql`${workspaceDocuments.settings}->>'section' = 'ideas'`)).orderBy(asc(workspaceDocuments.createdAt)).limit(1);
  return doc?.slug ?? null;
}

/** Report 38.13 W9 (`nb ideas list`, networkbase_idea_list, plan A5.3): the ranked ideas. Members only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const slug = await firstIdeasDoc(id);
    if (!slug) return jsonSuccess({ doc: null, ideas: [], dropped: 0 });
    const r = await readIdeasAction(id, slug);
    if (!r.success) return jsonError("Not found", 404, "NOT_FOUND");
    return jsonSuccess({ doc: slug, ideas: r.ranked.map((i) => ({ rank: i.rank, number: i.number, title: i.title, pitch: i.pitch, impact: i.impact, ease: i.ease, confidence: i.confidence,
      score: i.score, stage: i.stage, validation: i.validation, builtAs: i.builtAs?.number ?? null })), dropped: r.dropped.length });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/ideas", fallback: "Couldn’t read ideas" });
  }
}

/** W9: `nb ideas add "Template shop" --impact 4 --ease 3 --confidence 2`; agents may add ideas (Start building needs a person). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const s15 = z.number().int().min(1).max(5).optional();
    const body = z.object({ title: z.string().trim().min(1).max(200), pitch: z.string().trim().max(200).optional(), impact: s15, ease: s15, confidence: s15 }).safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Give the idea a name; scores run from 1 to 5", 400, "BAD_REQUEST");
    const held = await agentGate(auth, request, body.data, { workspaceId: id, kinds: ["small"], summary: `Add idea "${body.data.title}"` });
    if (held) return held;
    const slug = await firstIdeasDoc(id);
    if (!slug) return jsonError("Make an Ideas document first (Documents → Ideas)", 409, "CONFLICT");
    const r = await addIdeaAction(id, { docSlug: slug, ...body.data });
    if (!r.success) return jsonError(r.error, 403, "FORBIDDEN");
    return jsonSuccess({ number: r.number });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/ideas", fallback: "Couldn’t add the idea" });
  }
}
