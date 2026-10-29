import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chatChannels, fileVersions, orgEmailInvites, profiles, workspaceDocuments, workspaceDocumentVersions, workspaceMembers, workspaceNodes,
  workspaces, workspaceSprints, taskSubtasks, tasks,
} from "@/lib/db/schema";
import { syncWorkspaceChat } from "@/lib/messaging/integrations";
import { generateWorkspaceKey } from "@/lib/workspace-key";
import { countUnregisteredWorkspaceStorage, scheduleWorkspaceStorageDeletion } from "@/lib/workspaces/server/lifecycle";
import type { AssignmentSettings } from "@/lib/organizations/assignment-rules";
import { createMasterTask } from "@/lib/organizations/assignments";
import { detachFromOrg } from "@/lib/organizations/children";
import { generateJoinCode } from "@/lib/organizations/join-rules";
import { notifyOrg, orgHref, orgLabel, queueOrgEmails } from "@/lib/organizations/notify";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// Archive, delete with a 30-day grace, restore, purge and duplicate (report §30.5). Owners act through
// src/app/actions/org-lifecycle.ts; the purge and duplicate run in Inngest (src/inngest/functions/org-lifecycle.ts).

export const ORG_DELETION_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

async function everyone(orgId: string) {
  const [org] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  const members = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.projectId, orgId));
  return [...new Set([org?.ownerId, ...members.map((m) => m.userId)].filter((id): id is string => Boolean(id)))];
}

/** What the confirmation dialogs show before archive or delete. */
export async function orgLifecyclePreview(orgId: string) {
  const [counts] = await db.execute<{ children: number; members: number; files: number; sprints: number }>(sql`
    SELECT (SELECT count(*)::int FROM workspaces c WHERE c.parent_id = ${orgId} AND c.deleted_at IS NULL) AS children,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = ${orgId}) AS members,
      (SELECT count(*)::int FROM workspace_nodes n WHERE n.workspace_id = ${orgId} AND n.type = 'file' AND n.deleted_at IS NULL) AS files,
      (SELECT count(*)::int FROM workspace_sprints s WHERE s.workspace_id = ${orgId} AND s.status IN ('planning', 'active')) AS sprints`);
  const children = await db.select({ id: workspaces.id, title: workspaces.title, ownerId: workspaces.ownerId }).from(workspaces)
    .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
  return { ...(counts ?? { children: 0, members: 0, files: 0, sprints: 0 }), childProjects: children };
}

/** Archive: read-only, join code off, scheduled work stops, child projects archived with it, E10 to everyone. */
export async function archiveOrg(orgId: string, actorId: string) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(workspaces).set({ status: "archived", joinCodeEnabled: false, updatedAt: now }).where(eq(workspaces.id, orgId));
    await tx.update(workspaces).set({
      status: "archived",
      orgSettings: sql`${workspaces.orgSettings} || '{"archivedWithOrg": true}'::jsonb`,
      updatedAt: now,
    }).where(and(eq(workspaces.parentId, orgId), ne(workspaces.status, "archived"), isNull(workspaces.deletedAt)));
  });
  const org = await orgLabel(orgId);
  if (org) {
    await notifyOrg({
      orgId, eventKey: "org.lifecycle", actorId, to: await everyone(orgId), title: `${org.title} has ended. Everything is read-only`,
      href: orgHref(org), sourceEventId: `archived:${orgId}:${now.getTime()}`, email: { kind: "org_ended" },
    });
  }
}

/** Unarchive: everything back, a new join code (off until switched on); sprints never start retroactively. */
export async function unarchiveOrg(orgId: string, actorId: string) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(workspaces).set({ status: "active", joinCode: generateJoinCode(), joinCodeEnabled: false, updatedAt: now }).where(eq(workspaces.id, orgId));
    await tx.update(workspaces).set({
      status: "active",
      orgSettings: sql`${workspaces.orgSettings} - 'archivedWithOrg'`,
      updatedAt: now,
    }).where(and(eq(workspaces.parentId, orgId), sql`${workspaces.orgSettings} ? 'archivedWithOrg'`, isNull(workspaces.deletedAt)));
    // Auto-start dates that passed while archived don't fire now.
    await tx.update(workspaceSprints).set({ autoStart: false, updatedAt: now })
      .where(and(eq(workspaceSprints.projectId, orgId), eq(workspaceSprints.status, "planning"), eq(workspaceSprints.autoStart, true), lte(workspaceSprints.startDate, now)));
  });
  const org = await orgLabel(orgId);
  if (org) {
    await notifyOrg({ orgId, eventKey: "org.lifecycle", actorId, to: await everyone(orgId), title: `${org.title} is open again`, href: orgHref(org), sourceEventId: `unarchived:${orgId}:${now.getTime()}` });
  }
}

/**
 * Delete (report §30.5): child projects detach to their leads (default) or are deleted with the org; the org is
 * hidden for 30 days, then purged. E14 goes out now with the date.
 */
export async function scheduleOrgDeletion(orgId: string, actorId: string, childMode: "detach" | "delete") {
  const now = new Date();
  const recipients = await everyone(orgId);
  const children = await db.select({ id: workspaces.id, title: workspaces.title, ownerId: workspaces.ownerId }).from(workspaces)
    .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
  if (childMode === "detach") {
    for (const child of children) await detachFromOrg(child.id);
  } else if (children.length) {
    await db.update(workspaces).set({ deletionScheduledAt: now, updatedAt: now }).where(inArray(workspaces.id, children.map((c) => c.id)));
  }
  await db.update(workspaces).set({ deletionScheduledAt: now, joinCodeEnabled: false, updatedAt: now }).where(eq(workspaces.id, orgId));
  const org = await orgLabel(orgId);
  if (!org) return { deleteAt: new Date(now.getTime() + ORG_DELETION_GRACE_DAYS * DAY_MS) };
  const led = new Map<string, string[]>();
  if (childMode === "detach") for (const child of children) led.set(child.ownerId, [...(led.get(child.ownerId) ?? []), child.title]);
  await notifyOrg({
    orgId, eventKey: "org.lifecycle", actorId, to: recipients,
    title: `${org.title} was deleted`, body: `It will be removed for good in ${ORG_DELETION_GRACE_DAYS} days. Download your submissions from My work before then.`,
    href: "/workspaces", sourceEventId: `deleted:${orgId}:${now.getTime()}`,
    email: { kind: "org_deleted", data: (userId) => ({ personalProjects: led.get(userId) ?? [] }) },
  });
  return { deleteAt: new Date(now.getTime() + ORG_DELETION_GRACE_DAYS * DAY_MS) };
}

/** Restore within the grace: the org (and child projects deleted with it) come back; detached ones stay personal. */
export async function restoreOrg(orgId: string, actorId: string) {
  const [org] = await db.select({ scheduledAt: workspaces.deletionScheduledAt }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  if (!org?.scheduledAt) return false;
  const now = new Date();
  await db.update(workspaces).set({ deletionScheduledAt: null, updatedAt: now })
    .where(sql`${workspaces.id} = ${orgId} OR (${workspaces.parentId} = ${orgId} AND ${workspaces.deletionScheduledAt} = ${org.scheduledAt.toISOString()}::timestamptz)`);
  const label = await orgLabel(orgId);
  if (label) await notifyOrg({ orgId, eventKey: "org.lifecycle", actorId, to: await everyone(orgId), title: `${label.title} was restored`, href: orgHref(label), sourceEventId: `restored:${orgId}:${now.getTime()}` });
  return true;
}

/**
 * After the grace: the org, its child projects deleted with it, files (storage cleanup), chat, assignments and
 * submissions go. Contribution entries stay, keeping the name as it was.
 */
export async function purgeDueOrgs(now = new Date(), limit = 20) {
  const due = await db.select({ id: workspaces.id, title: workspaces.title, ownerId: workspaces.ownerId }).from(workspaces)
    .where(and(isNotNull(workspaces.deletionScheduledAt), lte(workspaces.deletionScheduledAt, new Date(now.getTime() - ORG_DELETION_GRACE_DAYS * DAY_MS)), isNull(workspaces.deletedAt)))
    .orderBy(workspaces.deletionScheduledAt).limit(limit);
  let purged = 0;
  for (const project of due) {
    if (await countUnregisteredWorkspaceStorage(project.id) > 0) {
      logger.warn("org.purge.storage_pending", { module: "organizations", projectId: project.id });
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE profile_contributions SET workspace_id = NULL, external_key = 'deleted-project:' || ${project.id}::text,
          project_title = coalesce(nullif(btrim(project_title), ''), ${project.title}), updated_at = now()
        WHERE workspace_id = ${project.id}`);
      await scheduleWorkspaceStorageDeletion(tx, project.id);
      const gone = await tx.delete(workspaces).where(eq(workspaces.id, project.id)).returning({ id: workspaces.id });
      if (gone.length) await tx.update(profiles).set({ projectsCount: sql`GREATEST(0, ${profiles.projectsCount} - 1)` }).where(eq(profiles.id, project.ownerId));
    });
    purged++;
  }
  return { purged };
}

export type DuplicateOptions = {
  title: string;
  handle: string;
  termStart: string | null;
  copy: { about: boolean; docs: boolean; files: boolean; sprints: boolean; assignments: boolean; channels: boolean; admins: boolean };
};

/** Shift a date by the term move (new term start − old term start), whole days. */
export function shiftBy(date: Date | null, deltaMs: number) {
  return date ? new Date(date.getTime() + deltaMs) : null;
}

/**
 * Duplicate (report §30.5): a new org with the ticked parts. Never members, child projects, submissions,
 * messages, posts, contributions or the join code. Runs in the background; the owner is told when it's ready.
 */
export async function duplicateOrg(sourceId: string, actorId: string, options: DuplicateOptions) {
  const [source] = await db.select().from(workspaces).where(and(eq(workspaces.id, sourceId), eq(workspaces.kind, "organization"))).limit(1);
  if (!source) throw new Error("Organization not found");
  const deltaMs = options.termStart && source.termStart ? Date.parse(`${options.termStart}T00:00:00Z`) - Date.parse(`${source.termStart}T00:00:00Z`) : 0;
  const shiftDate = (d: string | null) => (d ? new Date(Date.parse(`${d}T00:00:00Z`) + deltaMs).toISOString().slice(0, 10) : null);
  const keepSettings = Object.fromEntries(Object.entries(source.orgSettings ?? {}).filter(([k]) => !["changes", "detachRequest", "moveInRequest", "archivedWithOrg", "handleChangedAt"].includes(k)));

  const newId = await db.transaction(async (tx) => {
    const [created] = await tx.insert(workspaces).values({
      ownerId: actorId, title: options.title, slug: options.handle, key: `${generateWorkspaceKey(options.title)}${randomUUID().slice(0, 3).toUpperCase()}`, currentTaskNumber: 0,
      kind: "organization", orgType: source.orgType, visibility: source.visibility, status: "active",
      orgSettings: options.copy.about ? keepSettings : { version: 1, roleNames: (source.orgSettings as { roleNames?: unknown })?.roleNames },
      description: options.copy.about ? source.description : null, shortDescription: options.copy.about ? source.shortDescription : null,
      coverImage: options.copy.about ? source.coverImage : null, welcomeNote: options.copy.about ? source.welcomeNote : null,
      timeZone: source.timeZone, termStart: options.termStart || shiftDate(source.termStart), termEnd: shiftDate(source.termEnd),
      taskReviewRequired: source.taskReviewRequired, joinCode: generateJoinCode(), joinCodeEnabled: true,
    }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ projectId: created!.id, userId: actorId, role: "owner" });
    await syncWorkspaceChat(tx, created!.id, null, "ensure_default");
    return created!.id;
  });

  // Folders and admin files (never submissions: nodes on a task), then docs pointing at the copied files.
  const docs = options.copy.docs ? await db.select().from(workspaceDocuments).where(eq(workspaceDocuments.projectId, sourceId)) : [];
  const nodes = (options.copy.files || docs.some((d) => d.linkedNodeId))
    ? await db.select().from(workspaceNodes).where(and(eq(workspaceNodes.projectId, sourceId), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId))).orderBy(workspaceNodes.path)
    : [];
  const docNodeIds = new Set(docs.map((d) => d.linkedNodeId).filter(Boolean));
  const wanted = options.copy.files ? nodes : nodes.filter((n) => n.type === "folder" ? docs.some((d) => {
    const linked = nodes.find((x) => x.id === d.linkedNodeId);
    return linked ? linked.path.startsWith(`${n.path}/`) : false;
  }) : docNodeIds.has(n.id));
  const nodeMap = await copyNodes(wanted, sourceId, newId, actorId);
  for (const doc of docs) {
    const [version] = doc.publishedVersionId ? await db.select().from(workspaceDocumentVersions).where(eq(workspaceDocumentVersions.id, doc.publishedVersionId)).limit(1) : [];
    const [copy] = await db.insert(workspaceDocuments).values({
      projectId: newId, slug: doc.slug, filename: doc.filename, settings: doc.settings, linkedNodeId: doc.linkedNodeId ? nodeMap.get(doc.linkedNodeId) ?? null : null,
    }).onConflictDoNothing().returning({ id: workspaceDocuments.id });
    if (copy && version) {
      const [v] = await db.insert(workspaceDocumentVersions).values({
        projectId: newId, docId: copy.id, versionNumber: 1, content: version.content, excerpt: version.excerpt, headings: version.headings,
        qualityReport: version.qualityReport, contentHash: version.contentHash, changeSummary: "Copied with the organization", createdBy: actorId,
      }).returning({ id: workspaceDocumentVersions.id });
      await db.update(workspaceDocuments).set({ publishedVersionId: v!.id }).where(eq(workspaceDocuments.id, copy.id));
    }
  }

  // Sprint plan with shifted dates, then assignments as drafts in the matching sprint.
  const sprintMap = new Map<string, string>();
  if (options.copy.sprints || options.copy.assignments) {
    const sprints = options.copy.sprints ? await db.select().from(workspaceSprints).where(eq(workspaceSprints.projectId, sourceId)).orderBy(workspaceSprints.sprintNumber) : [];
    for (const sprint of sprints) {
      const [s] = await db.insert(workspaceSprints).values({
        projectId: newId, sprintNumber: sprint.sprintNumber, name: sprint.name, goal: sprint.goal, description: sprint.description,
        startDate: shiftBy(sprint.startDate, deltaMs)!, endDate: shiftBy(sprint.endDate, deltaMs)!, status: "planning", autoStart: sprint.autoStart,
        showInChildren: sprint.showInChildren, creatorId: actorId,
      }).returning({ id: workspaceSprints.id });
      sprintMap.set(sprint.id, s!.id);
    }
  }
  if (options.copy.assignments) {
    const masters = await db.select().from(tasks).where(and(eq(tasks.projectId, sourceId), eq(tasks.kind, "assignment"), isNull(tasks.deletedAt)));
    for (const master of masters) {
      const steps = await db.select({ title: taskSubtasks.title }).from(taskSubtasks).where(eq(taskSubtasks.taskId, master.id)).orderBy(taskSubtasks.position);
      const settings = { ...(master.assignmentSettings as AssignmentSettings), publishedAt: null, closedAt: null };
      if (settings.lateUntil) settings.lateUntil = shiftBy(new Date(settings.lateUntil), deltaMs)!.toISOString();
      await createMasterTask(db, {
        orgId: newId, title: master.title, description: master.description, dueDate: shiftBy(master.dueDate, deltaMs) ?? new Date(),
        sprintId: master.sprintId ? sprintMap.get(master.sprintId) ?? null : null, creatorId: actorId, settings, steps: steps.map((s) => s.title),
      });
    }
  }

  // Org channel names and topics (#general already exists).
  if (options.copy.channels) {
    const channels = await db.select({ name: chatChannels.name, topic: chatChannels.topic, kind: chatChannels.kind }).from(chatChannels)
      .where(and(eq(chatChannels.projectId, sourceId), eq(chatChannels.isDefault, false), isNull(chatChannels.applicationId), sql`${chatChannels.kind} IN ('public', 'private')`, isNotNull(chatChannels.name)));
    for (const channel of channels) {
      await db.execute(sql`SELECT app_private.chat_create_channel(${newId}::uuid, ${actorId}::uuid, ${channel.name}, ${channel.topic ?? ""}, ${channel.kind === "private"})`).catch(() => undefined);
    }
  }

  // Invite the current admins (they accept in-app, as with any invite).
  if (options.copy.admins) {
    const admins = await db.select({ email: profiles.email }).from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.projectId, sourceId), eq(workspaceMembers.role, "admin"), ne(workspaceMembers.userId, actorId)));
    for (const admin of admins) {
      await db.insert(orgEmailInvites).values({ orgId: newId, email: admin.email.toLowerCase(), role: "admin", invitedBy: actorId, expiresAt: new Date(Date.now() + 14 * DAY_MS) }).onConflictDoNothing();
    }
  }

  const [sourceLabel, label] = await Promise.all([orgLabel(sourceId), orgLabel(newId)]);
  if (label) {
    await notifyOrg({ orgId: newId, eventKey: "org.lifecycle", to: [actorId], title: `${label.title} created from ${sourceLabel?.title ?? "your organization"}`, href: orgHref(label), sourceEventId: `duplicated:${newId}` });
  }
  return newId;
}

/** Folders as rows; files as a server-side storage copy with their own asset, version 1 of the current file. */
async function copyNodes(nodes: Array<typeof workspaceNodes.$inferSelect>, sourceId: string, newId: string, actorId: string) {
  const map = new Map<string, string>();
  const admin = nodes.some((n) => n.type === "file") ? await createAdminClient() : null;
  for (const node of nodes) {
    let assetId: string | null = null;
    let s3Key: string | null = null;
    if (node.type === "file" && node.assetId && admin) {
      const [asset] = await db.execute<{ id: string; bucket: string; storage_key: string }>(sql`SELECT id, bucket, storage_key FROM storage_assets WHERE id = ${node.assetId} AND state = 'verified'`);
      if (!asset) continue;
      const key = asset.storage_key.startsWith(`${sourceId}/`) ? `${newId}/${asset.storage_key.slice(sourceId.length + 1)}` : `${newId}/copies/${randomUUID()}/${node.name}`;
      const { error } = await admin.storage.from(asset.bucket).copy(asset.storage_key, key);
      if (error) {
        logger.warn("org.duplicate.copy_failed", { module: "organizations", nodeId: node.id, error: error.message });
        continue;
      }
      const [copied] = await db.execute<{ id: string }>(sql`
        INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size,
          verified_mime_type, verified_size, content_hash, source_asset_id, metadata, quota_tracked, expires_at, verified_at)
        SELECT ${actorId}::uuid, ${newId}::uuid, bucket, ${key}, purpose, 'verified', declared_mime_type, declared_size,
          verified_mime_type, verified_size, content_hash, id, metadata, quota_tracked, expires_at, now()
        FROM storage_assets WHERE id = ${asset.id} RETURNING id`);
      assetId = copied!.id;
      s3Key = key;
    }
    const [created] = await db.insert(workspaceNodes).values({
      projectId: newId, parentId: node.parentId ? map.get(node.parentId) ?? null : null, path: node.path, type: node.type, name: node.name,
      createdBy: actorId, s3Key, assetId, size: node.size, mimeType: node.mimeType, metadata: node.metadata, currentVersion: node.type === "file" ? 1 : node.currentVersion,
    }).returning({ id: workspaceNodes.id });
    map.set(node.id, created!.id);
    if (node.type === "file" && assetId) {
      await db.insert(fileVersions).values({ nodeId: created!.id, version: 1, s3Key: s3Key!, assetId, size: node.size ?? 0, mimeType: node.mimeType ?? "application/octet-stream", uploadedBy: actorId });
    }
  }
  return map;
}
