import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readMeetingsAction } from "@/app/actions/workspace/doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report 38.11 W12 (`nb meetings list`, networkbase_meeting_list, plan A4.1b): meetings this person may read and their open action items. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const r = await readMeetingsAction(id);
    if (!r.success) return jsonError(r.error, 404, "NOT_FOUND");
    return jsonSuccess({
      timeZone: r.timeZone,
      meetings: r.meetings.map((m) => ({ slug: m.slug, title: m.title, type: m.type, startsAt: m.startsAt, lengthMinutes: m.lengthMinutes, finished: m.finished, attendees: m.attendeeIds.length })),
      openActionItems: r.openActionItems.map((a) => ({ number: a.number, title: a.title, due: a.dueDate, assignee: a.assigneeName, meeting: a.meeting?.title ?? null })),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/meetings", fallback: "Couldn’t read meetings" });
  }
}
