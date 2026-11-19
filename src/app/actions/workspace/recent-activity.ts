"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { labelScopes, visibleViaOfPayload } from "@/lib/agents/via-scope";
import { db } from "@/lib/db";
import { githubSyncRuns, profiles, workspaceMembers, workspaceNodeEvents, workspaceNodes, workspaceWorkflows, taskActivityEvents, tasks } from "@/lib/db/schema";
import { catalogEntry } from "@/lib/workflows/catalog";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { orgFileAccessSql } from "@/lib/files/internal-helpers";
import { orgTaskReadFilter } from "@/lib/organizations/assignments";
import { getViewerIdentityContext } from "@/lib/server/viewer-context";
import { normalizeWorkspacePublicTabVisibility } from "@/lib/workspaces/settings-policies";
import { activityActorName, describeGithubPush, describeMembershipEvent, isPublishableFileMetadata, newestWorkspaceActivities, recentActivityAudience, type WorkspaceRecentActivityItem } from "@/lib/workspaces/recent-activity";

const actor = alias(profiles, "recent_activity_actor");
const member = alias(profiles, "recent_activity_member");

/** Only the three latest publishable project events cross this server-action boundary. */

export async function readWorkspaceRecentActivityAction(projectId: string): Promise<WorkspaceRecentActivityItem[]> {
  const viewer = await getViewerIdentityContext();
  const access = await getWorkspaceAccessById(projectId, viewer.userId);
  if (!access.project || !access.canRead) throw new Error("Workspace not found");
  const isMember = access.isOwner || access.isMember;
  const visibility = normalizeWorkspacePublicTabVisibility(access.project.publicTabVisibility);
  if (!isMember && !visibility.dashboard) throw new Error("Workspace not found");
  const audience = recentActivityAudience(isMember, visibility);
  const projectHref = `/workspaces/${encodeURIComponent(access.project.slug || projectId)}`;

  const memberEventsPromise = db.select({
    id: workspaceNodeEvents.id,
    type: workspaceNodeEvents.type,
    metadata: workspaceNodeEvents.metadata,
    createdAt: workspaceNodeEvents.createdAt,
    name: member.fullName,
    username: member.username,
    memberId: member.id,
  }).from(workspaceNodeEvents)
    .innerJoin(workspaceMembers, and(
      eq(workspaceMembers.projectId, projectId),
      sql`${workspaceNodeEvents.metadata}->>'targetUserId' = ${workspaceMembers.userId}::text`,
    ))
    .innerJoin(member, and(eq(member.id, workspaceMembers.userId), isNull(member.deletedAt)))
    .where(and(
      eq(workspaceNodeEvents.projectId, projectId),
      inArray(workspaceNodeEvents.type, ["workspace_member.added", "workspace_member.role_changed"]),
      sql`(${workspaceNodeEvents.type} = 'workspace_member.role_changed' OR
        coalesce(${workspaceNodeEvents.metadata}->>'previousRole', '') <> coalesce(${workspaceNodeEvents.metadata}->>'nextRole', ''))`,
      audience.requirePublicProfile ? eq(member.visibility, "public") : undefined,
    ))
    .orderBy(desc(workspaceNodeEvents.createdAt), desc(workspaceNodeEvents.id)).limit(3);

  const taskEventsPromise = audience.mayReadTasks
    ? db.select({ id: taskActivityEvents.id, eventType: taskActivityEvents.eventType, payload: taskActivityEvents.payload, createdAt: taskActivityEvents.createdAt,
      taskId: tasks.id, title: tasks.title, actorId: taskActivityEvents.actorId, actorName: actor.fullName, actorUsername: actor.username, actorVisibility: actor.visibility })
      .from(taskActivityEvents)
      .innerJoin(tasks, and(eq(tasks.id, taskActivityEvents.taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .leftJoin(actor, and(eq(actor.id, taskActivityEvents.actorId), isNull(actor.deletedAt)))
      .where(and(eq(taskActivityEvents.projectId, projectId), inArray(taskActivityEvents.eventType, ["status_changed", "review_submitted", "review_approved", "changes_requested"]),
        sql`${taskActivityEvents.payload}->>'to' IN ('in_progress', 'done')`,
        // In an organization, members never see other people's assignment copies (report §16, §27.2).
        orgTaskReadFilter(access, viewer.userId, "review")))
      .orderBy(desc(taskActivityEvents.createdAt), desc(taskActivityEvents.id)).limit(3)
    : Promise.resolve([]);

  const fileEventsPromise = audience.mayReadFiles
    ? db.select({ id: workspaceNodeEvents.id, createdAt: workspaceNodeEvents.createdAt,
      nodeId: workspaceNodes.id, name: workspaceNodes.name, path: workspaceNodes.path, taskId: workspaceNodes.taskId, eventMetadata: workspaceNodeEvents.metadata,
      metadata: workspaceNodes.metadata, actorId: workspaceNodeEvents.actorId, actorName: actor.fullName, actorUsername: actor.username, actorVisibility: actor.visibility })
      .from(workspaceNodeEvents)
      .innerJoin(workspaceNodes, and(eq(workspaceNodes.id, workspaceNodeEvents.nodeId), eq(workspaceNodes.projectId, projectId),
        eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt)))
      .leftJoin(actor, and(eq(actor.id, workspaceNodeEvents.actorId), isNull(actor.deletedAt)))
      .where(and(eq(workspaceNodeEvents.projectId, projectId), eq(workspaceNodeEvents.type, "create_file"),
        // ...nor Admins-only files (report §23.3).
        orgFileAccessSql(access),
        isMember ? undefined : sql`coalesce(${workspaceNodes.metadata}->>'visibility', 'public') = 'public'
          AND coalesce(${workspaceNodes.metadata}->'privacy'->>'visibility', 'public') = 'public'
          AND coalesce(${workspaceNodes.metadata}->>'isSystem', 'false') <> 'true'
          AND coalesce(${workspaceNodes.metadata}->>'publicVisible', 'true') <> 'false'
          AND coalesce(${workspaceNodes.metadata}->'privacy'->>'publicVisible', 'true') <> 'false'
          AND coalesce(${workspaceNodes.metadata}->'privacy'->>'private', 'false') <> 'true'
          AND coalesce(${workspaceNodes.metadata}->'analytics'->>'publicVisible', 'true') <> 'false'
          AND coalesce(${workspaceNodes.metadata}->>'analyticsVisible', 'true') <> 'false'
          AND coalesce(${workspaceNodes.metadata}->'analytics'->>'analyticsVisible', 'true') <> 'false'`,
        isMember ? undefined : audience.mayReadTaskFiles
          ? sql`(${workspaceNodes.path} NOT LIKE '/.system%' OR ${workspaceNodes.taskId} IS NOT NULL)`
          : and(isNull(workspaceNodes.taskId), sql`${workspaceNodes.path} NOT LIKE '/.system%'`),
      ))
      .orderBy(desc(workspaceNodeEvents.createdAt), desc(workspaceNodeEvents.id)).limit(3)
    : Promise.resolve([]);

  const githubEventsPromise = db.select({ id: githubSyncRuns.id, manifest: githubSyncRuns.manifest, result: githubSyncRuns.result,
    updatedAt: githubSyncRuns.updatedAt, actorName: actor.fullName, actorUsername: actor.username, actorVisibility: actor.visibility })
    .from(githubSyncRuns)
    .leftJoin(actor, and(eq(actor.id, githubSyncRuns.actorId), isNull(actor.deletedAt)))
    .where(and(eq(githubSyncRuns.projectId, projectId), eq(githubSyncRuns.status, "completed"),
      sql`${githubSyncRuns.manifest}->>'direction' = 'push'`,
      sql`((${githubSyncRuns.manifest}->>'mode' = 'direct' AND ${githubSyncRuns.result}->>'pushed' = 'true')
        OR (${githubSyncRuns.manifest}->>'mode' = 'pr' AND nullif(${githubSyncRuns.result}->>'pullRequestUrl', '') IS NOT NULL))`))
    .orderBy(desc(githubSyncRuns.updatedAt), desc(githubSyncRuns.id)).limit(3);

  // Report 38.2 call 8: adding or hiding a workflow goes into activity, for people inside the workspace only (B11).
  const workflowEventsPromise = isMember || access.isInheritedAdmin
    ? db.select({ id: workspaceWorkflows.id, workflow: workspaceWorkflows.workflow, hiddenAt: workspaceWorkflows.hiddenAt,
      at: sql<Date>`coalesce(${workspaceWorkflows.hiddenAt}, ${workspaceWorkflows.addedAt})`, actorName: actor.fullName, actorUsername: actor.username })
      .from(workspaceWorkflows)
      .leftJoin(actor, and(eq(actor.id, sql`coalesce(${workspaceWorkflows.hiddenBy}, ${workspaceWorkflows.addedBy})`), isNull(actor.deletedAt)))
      .where(eq(workspaceWorkflows.workspaceId, projectId))
      .orderBy(desc(sql`coalesce(${workspaceWorkflows.hiddenAt}, ${workspaceWorkflows.addedAt})`)).limit(3)
    : Promise.resolve([]);

  const [memberEvents, taskEvents, fileEvents, githubEvents, workflowEvents] = await Promise.all([
    memberEventsPromise, taskEventsPromise, fileEventsPromise, githubEventsPromise, workflowEventsPromise,
  ]);
  const items: WorkspaceRecentActivityItem[] = [];
  for (const event of memberEvents) {
    const metadata = event.metadata ?? {};
    const name = activityActorName({ fullName: event.name, username: event.username });
    const text = describeMembershipEvent(name, event.type as "workspace_member.added" | "workspace_member.role_changed", metadata);
    if (!text) continue;
    items.push({ id: `member:${event.id}`, type: "member",
      text,
      occurredAt: event.createdAt.toISOString(), href: projectHref });
  }
  // "with Claude Code" only where the workspace owner's setting allows this viewer to see it (report Part B).
  const labels = labelScopes(viewer.userId, projectId);
  for (const event of taskEvents) {
    const destination = event.payload?.to;
    const actorName = activityActorName(!isMember && event.actorVisibility !== "public" ? null : { fullName: event.actorName, username: event.actorUsername });
    items.push({ id: `task:${event.id}`, type: "task",
      text: event.eventType === "review_submitted" ? `${actorName} submitted ${event.title} for review` : event.eventType === "review_approved" ? `${actorName} approved and completed ${event.title}` : event.eventType === "changes_requested" ? `${actorName} requested changes on ${event.title}` : `${actorName} moved ${event.title} to ${destination === "done" ? "Completed" : "In progress"}`,
      occurredAt: event.createdAt.toISOString(), href: `${projectHref}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(event.taskId)}`,
      ...visibleViaOfPayload(await labels(event.taskId), event.payload, event.actorId) });
  }
  for (const event of fileEvents) {
    if (!isMember && !isPublishableFileMetadata(event.metadata)) continue;
    const actorName = activityActorName(!isMember && event.actorVisibility !== "public" ? null : { fullName: event.actorName, username: event.actorUsername });
    items.push({ id: `file:${event.id}`, type: "file", text: `${actorName} added ${event.name}`,
      occurredAt: event.createdAt.toISOString(), href: `${projectHref}?tab=files&fileId=${encodeURIComponent(event.nodeId)}`,
      ...visibleViaOfPayload(await labels(event.taskId), event.eventMetadata, event.actorId) });
  }
  for (const event of githubEvents) {
    const mode = event.manifest.mode === "pr" ? "pr" : "direct";
    const actorName = activityActorName(!isMember && event.actorVisibility !== "public" ? null : { fullName: event.actorName, username: event.actorUsername });
    items.push({ id: `github:${event.id}`, type: "github", text: describeGithubPush(actorName, mode),
      occurredAt: event.updatedAt.toISOString(),
      href: isMember ? `${projectHref}?tab=files&filesView=github` : projectHref });
  }
  for (const event of workflowEvents) {
    const name = catalogEntry(event.workflow)?.name;
    if (!name) continue;
    const actorName = activityActorName({ fullName: event.actorName, username: event.actorUsername });
    items.push({ id: `workflow:${event.id}:${event.hiddenAt ? "hid" : "added"}`, type: "workflow", text: `${actorName} ${event.hiddenAt ? "hid" : "added"} ${name}`,
      occurredAt: new Date(event.at).toISOString(), href: `${projectHref}?tab=settings&section=tasks-workflow` });
  }
  return newestWorkspaceActivities(items);
}
