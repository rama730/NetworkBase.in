"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { githubSyncRuns, profiles, projectMembers, projectNodeEvents, projectNodes, taskActivityEvents, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { orgFileAccessSql } from "@/lib/files/internal-helpers";
import { orgTaskReadFilter } from "@/lib/organizations/assignments";
import { getViewerIdentityContext } from "@/lib/server/viewer-context";
import { normalizeProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import { activityActorName, describeGithubPush, describeMembershipEvent, isPublishableFileMetadata, newestProjectActivities, recentActivityAudience, type ProjectRecentActivityItem } from "@/lib/projects/recent-activity";

const actor = alias(profiles, "recent_activity_actor");
const member = alias(profiles, "recent_activity_member");

/** Only the three latest publishable project events cross this server-action boundary. */
export async function readProjectRecentActivityAction(projectId: string): Promise<ProjectRecentActivityItem[]> {
  const viewer = await getViewerIdentityContext();
  const access = await getProjectAccessById(projectId, viewer.userId);
  if (!access.project || !access.canRead) throw new Error("Project not found");
  const isMember = access.isOwner || access.isMember;
  const visibility = normalizeProjectPublicTabVisibility(access.project.publicTabVisibility);
  if (!isMember && !visibility.dashboard) throw new Error("Project not found");
  const audience = recentActivityAudience(isMember, visibility);
  const projectHref = `/projects/${encodeURIComponent(access.project.slug || projectId)}`;

  const memberEventsPromise = db.select({
    id: projectNodeEvents.id,
    type: projectNodeEvents.type,
    metadata: projectNodeEvents.metadata,
    createdAt: projectNodeEvents.createdAt,
    name: member.fullName,
    username: member.username,
    memberId: member.id,
  }).from(projectNodeEvents)
    .innerJoin(projectMembers, and(
      eq(projectMembers.projectId, projectId),
      sql`${projectNodeEvents.metadata}->>'targetUserId' = ${projectMembers.userId}::text`,
    ))
    .innerJoin(member, and(eq(member.id, projectMembers.userId), isNull(member.deletedAt)))
    .where(and(
      eq(projectNodeEvents.projectId, projectId),
      inArray(projectNodeEvents.type, ["project_member.added", "project_member.role_changed"]),
      sql`(${projectNodeEvents.type} = 'project_member.role_changed' OR
        coalesce(${projectNodeEvents.metadata}->>'previousRole', '') <> coalesce(${projectNodeEvents.metadata}->>'nextRole', ''))`,
      audience.requirePublicProfile ? eq(member.visibility, "public") : undefined,
    ))
    .orderBy(desc(projectNodeEvents.createdAt), desc(projectNodeEvents.id)).limit(3);

  const taskEventsPromise = audience.mayReadTasks
    ? db.select({ id: taskActivityEvents.id, eventType: taskActivityEvents.eventType, payload: taskActivityEvents.payload, createdAt: taskActivityEvents.createdAt,
      taskId: tasks.id, title: tasks.title, actorName: actor.fullName, actorUsername: actor.username, actorVisibility: actor.visibility })
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
    ? db.select({ id: projectNodeEvents.id, createdAt: projectNodeEvents.createdAt,
      nodeId: projectNodes.id, name: projectNodes.name, path: projectNodes.path, taskId: projectNodes.taskId,
      metadata: projectNodes.metadata, actorName: actor.fullName, actorUsername: actor.username, actorVisibility: actor.visibility })
      .from(projectNodeEvents)
      .innerJoin(projectNodes, and(eq(projectNodes.id, projectNodeEvents.nodeId), eq(projectNodes.projectId, projectId),
        eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt)))
      .leftJoin(actor, and(eq(actor.id, projectNodeEvents.actorId), isNull(actor.deletedAt)))
      .where(and(eq(projectNodeEvents.projectId, projectId), eq(projectNodeEvents.type, "create_file"),
        // ...nor Admins-only files (report §23.3).
        orgFileAccessSql(access),
        isMember ? undefined : sql`coalesce(${projectNodes.metadata}->>'visibility', 'public') = 'public'
          AND coalesce(${projectNodes.metadata}->'privacy'->>'visibility', 'public') = 'public'
          AND coalesce(${projectNodes.metadata}->>'isSystem', 'false') <> 'true'
          AND coalesce(${projectNodes.metadata}->>'publicVisible', 'true') <> 'false'
          AND coalesce(${projectNodes.metadata}->'privacy'->>'publicVisible', 'true') <> 'false'
          AND coalesce(${projectNodes.metadata}->'privacy'->>'private', 'false') <> 'true'
          AND coalesce(${projectNodes.metadata}->'analytics'->>'publicVisible', 'true') <> 'false'
          AND coalesce(${projectNodes.metadata}->>'analyticsVisible', 'true') <> 'false'
          AND coalesce(${projectNodes.metadata}->'analytics'->>'analyticsVisible', 'true') <> 'false'`,
        isMember ? undefined : audience.mayReadTaskFiles
          ? sql`(${projectNodes.path} NOT LIKE '/.system%' OR ${projectNodes.taskId} IS NOT NULL)`
          : and(isNull(projectNodes.taskId), sql`${projectNodes.path} NOT LIKE '/.system%'`),
      ))
      .orderBy(desc(projectNodeEvents.createdAt), desc(projectNodeEvents.id)).limit(3)
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

  const [memberEvents, taskEvents, fileEvents, githubEvents] = await Promise.all([
    memberEventsPromise, taskEventsPromise, fileEventsPromise, githubEventsPromise,
  ]);
  const items: ProjectRecentActivityItem[] = [];
  for (const event of memberEvents) {
    const metadata = event.metadata ?? {};
    const name = activityActorName({ fullName: event.name, username: event.username });
    const text = describeMembershipEvent(name, event.type as "project_member.added" | "project_member.role_changed", metadata);
    if (!text) continue;
    items.push({ id: `member:${event.id}`, type: "member",
      text,
      occurredAt: event.createdAt.toISOString(), href: projectHref });
  }
  for (const event of taskEvents) {
    const destination = event.payload?.to;
    const actorName = activityActorName(!isMember && event.actorVisibility !== "public" ? null : { fullName: event.actorName, username: event.actorUsername });
    items.push({ id: `task:${event.id}`, type: "task",
      text: event.eventType === "review_submitted" ? `${actorName} submitted ${event.title} for review` : event.eventType === "review_approved" ? `${actorName} approved and completed ${event.title}` : event.eventType === "changes_requested" ? `${actorName} requested changes on ${event.title}` : `${actorName} moved ${event.title} to ${destination === "done" ? "Done" : "In progress"}`,
      occurredAt: event.createdAt.toISOString(), href: `${projectHref}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(event.taskId)}` });
  }
  for (const event of fileEvents) {
    if (!isMember && !isPublishableFileMetadata(event.metadata)) continue;
    const actorName = activityActorName(!isMember && event.actorVisibility !== "public" ? null : { fullName: event.actorName, username: event.actorUsername });
    items.push({ id: `file:${event.id}`, type: "file", text: `${actorName} added ${event.name}`,
      occurredAt: event.createdAt.toISOString(), href: `${projectHref}?tab=files&fileId=${encodeURIComponent(event.nodeId)}` });
  }
  for (const event of githubEvents) {
    const mode = event.manifest.mode === "pr" ? "pr" : "direct";
    const actorName = activityActorName(!isMember && event.actorVisibility !== "public" ? null : { fullName: event.actorName, username: event.actorUsername });
    items.push({ id: `github:${event.id}`, type: "github", text: describeGithubPush(actorName, mode),
      occurredAt: event.updatedAt.toISOString(),
      href: isMember ? `${projectHref}?tab=files&filesView=github` : projectHref });
  }
  return newestProjectActivities(items);
}
