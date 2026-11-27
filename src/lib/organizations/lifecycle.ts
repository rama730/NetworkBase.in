import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { joinSchoolAs } from "@/lib/organizations/school-push";

import { db } from "@/lib/db";
import {
  chatChannels, fileVersions, orgEmailInvites, profileAuditEvents, profiles, sprintMaterials, taskNodeLinks, workspaceDocuments, workspaceDocumentVersions, workspaceMembers, workspaceNodes,
  workspaces, workspaceSprints, taskSubtasks, tasks,
} from "@/lib/db/schema";
import { syncWorkspaceChat } from "@/lib/messaging/integrations";
import { generateWorkspaceKey } from "@/lib/workspace-key";
import { countUnregisteredWorkspaceStorage, scheduleWorkspaceStorageDeletion } from "@/lib/workspaces/server/lifecycle";
import { resetDuplicatedTarget, type AssignmentSettings } from "@/lib/organizations/assignment-rules";
import { createMasterTask, moveGroupWorkToLead } from "@/lib/organizations/assignments";
import { detachFromOrg } from "@/lib/organizations/children";
import { accountOrgLimit, createOrgEmailInvites, lastActiveHereSince } from "@/lib/organizations/members";
import { ownerAway, requestExpired } from "@/lib/organizations/takeover-rules";
import { generateJoinCode } from "@/lib/organizations/join-rules";
import { ORG_LIMITS } from "@/lib/organizations/config";
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

/**
 * What the confirmation dialogs show before archive or delete (report §19.1, §27.5, §45.7): each workspace with its
 * lead, members and files, work still waiting for review, each assignment's Download all, and after a restore the
 * workspaces that were kept apart.
 */
export async function orgLifecyclePreview(orgId: string, viewerId?: string | null) {
  const [counts] = await db.execute<{ children: number; members: number; files: number; sprints: number; waiting: number }>(sql`
    SELECT (SELECT count(*)::int FROM workspaces c WHERE c.parent_id = ${orgId} AND c.deleted_at IS NULL) AS children,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = ${orgId}) AS members,
      (SELECT count(*)::int FROM workspace_nodes n WHERE n.workspace_id = ${orgId} AND n.type = 'file' AND n.deleted_at IS NULL) AS files,
      (SELECT count(*)::int FROM workspace_sprints s WHERE s.workspace_id = ${orgId} AND s.status IN ('planning', 'active')) AS sprints,
      (SELECT count(*)::int FROM tasks c JOIN tasks m ON m.id = c.assignment_id WHERE m.workspace_id = ${orgId} AND c.deleted_at IS NULL AND c.review_status = 'pending') AS waiting`);
  const children = await db.execute<{ id: string; title: string; owner_id: string; lead: string | null; members: number; files: number }>(sql`
    SELECT w.id, w.title, w.owner_id, coalesce(p.full_name, p.username) AS lead,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS members,
      (SELECT count(*)::int FROM workspace_nodes n WHERE n.workspace_id = w.id AND n.type = 'file' AND n.deleted_at IS NULL) AS files
    FROM workspaces w LEFT JOIN profiles p ON p.id = w.owner_id
    WHERE w.parent_id = ${orgId} AND w.deleted_at IS NULL ORDER BY w.title`);
  const assignments = await db.execute<{ id: string; title: string }>(sql`
    SELECT m.id, m.title FROM tasks m WHERE m.workspace_id = ${orgId} AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM tasks c JOIN workspace_nodes n ON n.task_id = c.id AND n.type = 'file' AND n.deleted_at IS NULL WHERE c.assignment_id = m.id AND c.deleted_at IS NULL)
    ORDER BY m.title LIMIT 200`);
  const detached = await db.execute<{ id: string; title: string }>(sql`
    SELECT w.id, w.title FROM workspaces o, jsonb_array_elements_text(coalesce(o.org_settings->'detachedOnDelete', '[]'::jsonb)) d(id)
    JOIN workspaces w ON w.id = d.id::uuid WHERE o.id = ${orgId} AND w.parent_id IS NULL AND w.deleted_at IS NULL AND w.deletion_scheduled_at IS NULL ORDER BY w.title`);
  const c = counts ?? { children: 0, members: 0, files: 0, sprints: 0, waiting: 0 };
  return {
    children: c.children, members: c.members, files: c.files, sprints: c.sprints, waitingReviews: c.waiting,
    childProjects: children.map((w) => ({ id: w.id, title: w.title, ownerId: w.owner_id, lead: w.lead ?? "Someone", members: w.members, files: w.files, mine: w.owner_id === viewerId })),
    assignments: [...assignments], detached: [...detached],
  };
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
 * Delete (report §19.1, decision 29): each workspace the owner leads is kept as personal (the default) or deleted with
 * the organization; anyone else's is always kept and goes to its lead. Kept ones detach and become private now, and
 * are remembered so a restore can invite them back. The organization is hidden for 30 days, then purged.
 */
export async function scheduleOrgDeletion(orgId: string, actorId: string, choices: Record<string, "keep" | "delete">) {
  const now = new Date();
  const recipients = await everyone(orgId);
  const children = await db.select({ id: workspaces.id, title: workspaces.title, ownerId: workspaces.ownerId }).from(workspaces)
    .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
  const deleting = children.filter((c) => c.ownerId === actorId && choices[c.id] === "delete");
  const kept = children.filter((c) => !deleting.includes(c));
  for (const child of kept) await detachFromOrg(child.id);
  if (deleting.length) await db.update(workspaces).set({ deletionScheduledAt: now, updatedAt: now }).where(inArray(workspaces.id, deleting.map((c) => c.id)));
  await db.update(workspaces).set({
    deletionScheduledAt: now, joinCodeEnabled: false, updatedAt: now, takeoverRequestedBy: null, takeoverRequestedAt: null,
    orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('detachedOnDelete', ${JSON.stringify(kept.map((c) => c.id))}::jsonb)`,
  }).where(eq(workspaces.id, orgId));
  const org = await orgLabel(orgId);
  if (!org) return { deleteAt: new Date(now.getTime() + ORG_DELETION_GRACE_DAYS * DAY_MS), kept: kept.length, deleted: deleting.length };
  const led = new Map<string, string[]>();
  for (const child of kept) led.set(child.ownerId, [...(led.get(child.ownerId) ?? []), child.title]);
  await notifyOrg({
    orgId, eventKey: "org.lifecycle", actorId, to: recipients,
    title: `${org.title} was deleted`, body: `It will be removed for good in ${ORG_DELETION_GRACE_DAYS} days. Download your submissions from My work before then.`,
    href: "/workspaces", sourceEventId: `deleted:${orgId}:${now.getTime()}`,
    email: { kind: "org_deleted", data: (userId) => ({ personalProjects: led.get(userId) ?? [] }) },
  });
  return { deleteAt: new Date(now.getTime() + ORG_DELETION_GRACE_DAYS * DAY_MS), kept: kept.length, deleted: deleting.length };
}

/** After a restore (report §19.1): the owner invites a kept workspace back; its lead moves it in with one click. */
export async function inviteBack(orgId: string, projectId: string, actorId: string) {
  const [row] = await db.execute<{ id: string; title: string; slug: string | null; owner_id: string }>(sql`
    SELECT w.id, w.title, w.slug, w.owner_id FROM workspaces o, jsonb_array_elements_text(coalesce(o.org_settings->'detachedOnDelete', '[]'::jsonb)) d(id)
    JOIN workspaces w ON w.id = d.id::uuid WHERE o.id = ${orgId} AND w.id = ${projectId} AND w.parent_id IS NULL AND w.deleted_at IS NULL`);
  if (!row) return false;
  await db.update(workspaces).set({
    orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('invitedBack', coalesce(${workspaces.orgSettings}->'invitedBack', '[]'::jsonb) || to_jsonb(${projectId}::text))`,
  }).where(eq(workspaces.id, orgId));
  const org = await orgLabel(orgId);
  if (org) {
    await notifyOrg({
      orgId, eventKey: "org.lifecycle", actorId, to: [row.owner_id], title: `${org.title} invited ${row.title} back. Move it in from its Settings.`,
      href: `/workspaces/${encodeURIComponent(row.slug ?? row.id)}?tab=settings&section=child-org`, sourceEventId: `invite-back:${projectId}:${Date.now()}`,
    });
  }
  return true;
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
  /** B2.1a Start a cohort (report 31.2): the program it runs, its seats and how people join. */
  cohort?: { programId: string; seats: number | null; joinMode: "approval" | "instant"; end?: string | null };
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
  // Security review (B2.1a): re-checked when the queued copy runs — only the source's owner or admins copy its content.
  const { getWorkspaceAccessById } = await import("@/lib/data/workspace-access");
  const access = await getWorkspaceAccessById(sourceId, actorId);
  if (!access.canRead || !(access.isOwner || access.memberRole === "admin")) throw new Error("Only the organization's owner or admins can duplicate it");
  // Dates move from the old term start, or else from the first sprint (decision 52, report §27.4).
  // B8.2c (report 37.4 call 7): a team for a fixed time runs again from its key date.
  const { carryOver, nextTimeTasks, readFixedTime } = await import("@/lib/organizations/fixed-time");
  const fixed = readFixedTime(source.orgSettings);
  const [firstSprint] = source.termStart || fixed ? [] : await db.select({ start: sql<Date | null>`min(${workspaceSprints.startDate})` }).from(workspaceSprints).where(eq(workspaceSprints.projectId, sourceId));
  const anchor = source.termStart ? Date.parse(`${source.termStart}T00:00:00Z`) : fixed ? Date.parse(`${fixed.keyDate}T00:00:00Z`) : firstSprint?.start ? new Date(firstSprint.start).getTime() : null;
  const deltaMs = options.termStart && anchor !== null ? Date.parse(`${options.termStart}T00:00:00Z`) - anchor : 0;
  const shiftDate = (d: string | null) => (d ? new Date(Date.parse(`${d}T00:00:00Z`) + deltaMs).toISOString().slice(0, 10) : null);
  const keepSettings = Object.fromEntries(Object.entries(source.orgSettings ?? {}).filter(([k]) => !["changes", "detachRequest", "moveInRequest", "archivedWithOrg", "handleChangedAt", "institutionRequest"].includes(k)));
  // The copy keeps the dates' distance from its new key date and pins this run's debrief; no plan, moves or wrap-up.
  if (fixed) keepSettings.fixedTime = carryOver(fixed, options.termStart || fixed.keyDate, source.title);

  const newId = await db.transaction(async (tx) => {
    // Audit N24: the 5-owned limit is checked again here, so duplicates queued at once can't all pass.
    if (await accountOrgLimit(tx, actorId, "own")) return null;
    const [created] = await tx.insert(workspaces).values({
      ownerId: actorId, title: options.title, slug: options.handle, key: `${generateWorkspaceKey(options.title)}${randomUUID().slice(0, 3).toUpperCase()}`, currentTaskNumber: 0,
      kind: "organization", orgType: source.orgType, visibility: source.visibility, status: "active",
      // A school is copied as a school; a class's school link is asked for again below (B0.2 security review).
      orgLevel: source.orgLevel,
      orgSettings: options.copy.about ? keepSettings : { version: 1, roleNames: (source.orgSettings as { roleNames?: unknown })?.roleNames, ...(fixed ? { fixedTime: keepSettings.fixedTime } : {}) },
      description: options.copy.about ? source.description : null, shortDescription: options.copy.about ? source.shortDescription : null,
      coverImage: options.copy.about ? source.coverImage : null, welcomeNote: options.copy.about ? source.welcomeNote : null,
      timeZone: source.timeZone, termStart: options.termStart || shiftDate(source.termStart), termEnd: shiftDate(source.termEnd),
      taskReviewRequired: source.taskReviewRequired, joinCode: generateJoinCode(), joinCodeEnabled: true,
    }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ projectId: created!.id, userId: actorId, role: "owner" });
    await syncWorkspaceChat(tx, created!.id, null, "ensure_default");
    return created!.id;
  });
  if (!newId) {
    const sourceLabel = await orgLabel(sourceId);
    if (sourceLabel) await notifyOrg({ orgId: sourceId, eventKey: "org.lifecycle", to: [actorId], title: `Couldn’t make ${options.title}: you can own up to ${ORG_LIMITS.orgsOwnedPerUser} organizations.`,
      href: orgHref(sourceLabel, "?tab=settings&section=org-management"), sourceEventId: `duplicate-limit:${sourceId}:${Date.now()}` });
    return null;
  }

  try {
    const filled = await fillDuplicate(sourceId, newId, actorId, options, deltaMs);
    // Last debrief's "Next time" lines become tasks in the new run.
    const next = fixed ? nextTimeTasks(fixed.debrief) : [];
    if (next.length) {
      const { insertTask } = await import("@/lib/organizations/assignments");
      await db.transaction(async (tx) => { for (const title of next) await insertTask(tx as never, { projectId: newId, title, description: "From last run’s debrief (Next time).", dueDate: null, sprintId: null,
        assigneeId: null, creatorId: actorId, kind: "task", assignmentId: null, assignmentSettings: null, teamName: null }); });
    }
    // B0.2 Start next term: the copy joins the same school the way a new class does — at once for its admins, else as a request.
    if (source.institutionId) await joinSchoolAs(newId, source.institutionId, actorId);
    if (options.cohort) {
      await db.update(workspaces).set({
        orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ programId: options.cohort.programId, joinMode: options.cohort.joinMode })}::jsonb`,
        maxCollaborators: options.cohort.seats == null ? null : String(options.cohort.seats),
        // Found live (B2.1a): the program's length sets the end the form promised, not the old term's exact days.
        ...(options.cohort.end ? { termEnd: options.cohort.end } : {}),
      }).where(eq(workspaces.id, newId));
    }
    return filled;
  } catch (error) {
    // Report §27.4: a failed duplicate leaves nothing half made, and the owner is told.
    logger.warn("org.duplicate.failed", { module: "organizations", sourceId, error: error instanceof Error ? error.message : String(error) });
    await db.delete(workspaces).where(eq(workspaces.id, newId));
    const sourceLabel = await orgLabel(sourceId);
    if (sourceLabel) await notifyOrg({ orgId: sourceId, eventKey: "org.lifecycle", to: [actorId], title: `Couldn’t finish ${options.title}. Try duplicating again.`, href: orgHref(sourceLabel, "?tab=settings&section=org-management"), sourceEventId: `duplicate-failed:${newId}` });
    throw error;
  }
}

async function fillDuplicate(sourceId: string, newId: string, actorId: string, options: DuplicateOptions, deltaMs: number) {
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
    // B3.2d (report 32.3 call 10): the Term plan comes along — weeks keep their unit, Path steps their place, and
    // lessons go back to Planned without Taught ticks, class notes or teacher notes (those stay with the old course).
    for (const sprint of sprints) {
      if (!sprint.parentSprintId && sprint.pathPosition == null) continue;
      await db.update(workspaceSprints).set({ parentSprintId: sprint.parentSprintId ? sprintMap.get(sprint.parentSprintId) ?? null : null, pathPosition: sprint.pathPosition })
        .where(eq(workspaceSprints.id, sprintMap.get(sprint.id)!));
    }
    const { copyPlanLessons } = await import("@/lib/organizations/term-plan-server");
    await copyPlanLessons(sourceId, newId, sprintMap, actorId);
  }
  if (options.copy.assignments) {
    const masters = await db.select().from(tasks).where(and(eq(tasks.projectId, sourceId), eq(tasks.kind, "assignment"), isNull(tasks.deletedAt)));
    for (const master of masters) {
      const steps = await db.select({ title: taskSubtasks.title }).from(taskSubtasks).where(eq(taskSubtasks.taskId, master.id)).orderBy(taskSubtasks.position);
      const saved = master.assignmentSettings as AssignmentSettings;
      const { target, note } = resetDuplicatedTarget(saved.target);
      const settings = { ...saved, target, note, publishedAt: null, closedAt: null };
      if (settings.lateUntil) settings.lateUntil = shiftBy(new Date(settings.lateUntil), deltaMs)!.toISOString();
      const newMasterId = await createMasterTask(db, {
        orgId: newId, title: master.title, description: master.description, dueDate: shiftBy(master.dueDate, deltaMs) ?? new Date(),
        sprintId: master.sprintId ? sprintMap.get(master.sprintId) ?? null : null, creatorId: actorId, settings, steps: steps.map((s) => s.title),
      });
      // Smaller bug 7, decision 132: the assignment's own files come along, and its links to copied files.
      const own = await db.select().from(workspaceNodes).where(and(eq(workspaceNodes.taskId, master.id), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt)));
      const ownMap = await copyNodes(own.map((n) => ({ ...n, parentId: null, path: `/.system/tasks/${newMasterId}/${n.name}` })), sourceId, newId, actorId);
      if (ownMap.size) await db.update(workspaceNodes).set({ taskId: newMasterId }).where(inArray(workspaceNodes.id, [...ownMap.values()]));
      const links = await db.select({ nodeId: taskNodeLinks.nodeId, order: taskNodeLinks.order, annotation: taskNodeLinks.annotation }).from(taskNodeLinks).where(eq(taskNodeLinks.taskId, master.id));
      const kept = links.filter((l) => nodeMap.has(l.nodeId));
      if (kept.length) await db.insert(taskNodeLinks).values(kept.map((l) => ({ taskId: newMasterId, nodeId: nodeMap.get(l.nodeId)!, order: l.order, annotation: l.annotation, createdBy: actorId }))).onConflictDoNothing();
    }
  }
  // Decision 132: sprint materials follow their sprint, when the file came along too.
  if (sprintMap.size && nodeMap.size) {
    const materials = await db.select({ sprintId: sprintMaterials.sprintId, nodeId: sprintMaterials.nodeId }).from(sprintMaterials).where(inArray(sprintMaterials.sprintId, [...sprintMap.keys()]));
    const kept = materials.filter((m) => m.nodeId && nodeMap.has(m.nodeId));
    if (kept.length) await db.insert(sprintMaterials).values(kept.map((m) => ({ sprintId: sprintMap.get(m.sprintId)!, nodeId: nodeMap.get(m.nodeId!)!, addedBy: actorId }))).onConflictDoNothing();
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
    // Audit N7: through the usual invite path, so each admin is told (in-app and by email).
    if (admins.length) await createOrgEmailInvites(newId, actorId, { emails: admins.map((a) => a.email), role: "admin", title: null, childProjectId: null, unitId: null });
  }

  const [sourceLabel, label] = await Promise.all([orgLabel(sourceId), orgLabel(newId)]);
  // Report §27.4: dates still in the past are listed afterwards.
  const [past] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceSprints).where(and(eq(workspaceSprints.projectId, newId), sql`${workspaceSprints.startDate} < now()`));
  const pastLine = past?.n ? ` · ${past.n} ${past.n === 1 ? "sprint has a past date" : "sprints have past dates"}` : "";
  if (label) {
    await notifyOrg({ orgId: newId, eventKey: "org.lifecycle", to: [actorId], title: `${label.title} is ready, from ${sourceLabel?.title ?? "your organization"}${pastLine}`, href: orgHref(label), sourceEventId: `duplicated:${newId}` });
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

/**
 * Take over now (report §45.2): the asking admin becomes owner after 7 days without a refusal; the old owner becomes an
 * admin and is told. Runs the same swap as Transfer, recorded in both audit logs.
 */
export async function takeOverOrg(orgId: string, adminId: string, stepUpMethod: string | null) {
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const [org] = await tx.select({ ownerId: workspaces.ownerId, by: workspaces.takeoverRequestedBy, at: workspaces.takeoverRequestedAt, suspendedAt: workspaces.suspendedAt, deletionScheduledAt: workspaces.deletionScheduledAt })
      .from(workspaces).where(eq(workspaces.id, orgId)).limit(1).for("update");
    if (!org || org.by !== adminId || org.suspendedAt || org.deletionScheduledAt) return { error: "denied" as const };
    // Audit N4 (decision D-B): the request lasts 14 days, and the owner must still be away when it's used.
    if (!org.at || requestExpired(org.at, now)) return { error: "This request has expired. Ask again." };
    const [owner] = await tx.select({ lastActive: sql<string | null>`coalesce(${workspaceMembers.lastActiveHereAt}, ${workspaceMembers.joinedAt})::text` })
      .from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, org.ownerId))).limit(1);
    if (!ownerAway(owner?.lastActive ? new Date(owner.lastActive) : null, now, await lastActiveHereSince())) {
      await tx.update(workspaces).set({ takeoverRequestedBy: null, takeoverRequestedAt: null }).where(eq(workspaces.id, orgId));
      return { error: "The owner has been active here, so the request ended." };
    }
    // Still an admin here, under the request's lock (a demotion or removal since asking ends it).
    const [asker] = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, adminId))).limit(1).for("update");
    if (asker?.role !== "admin") return { error: "denied" as const };
    // The same owner limit as Transfer (report §27.1 #4).
    const limit = await accountOrgLimit(tx, adminId, "own");
    if (limit) return { error: limit };
    await tx.update(workspaces).set({ ownerId: adminId, takeoverRequestedBy: null, takeoverRequestedAt: null, updatedAt: now }).where(eq(workspaces.id, orgId));
    await tx.update(workspaceMembers).set({ role: "admin" }).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, org.ownerId)));
    await tx.update(workspaceMembers).set({ role: "owner" }).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, adminId)));
    await moveGroupWorkToLead(tx, orgId, adminId);
    await syncWorkspaceChat(tx, orgId, adminId, "role");
    await syncWorkspaceChat(tx, orgId, org.ownerId, "role");
    await tx.insert(profileAuditEvents).values([
      { userId: org.ownerId, eventType: "project_ownership_transferred_out", previousValue: { ownerId: org.ownerId }, nextValue: { ownerId: adminId }, metadata: { projectId: orgId, newOwnerId: adminId, actorId: adminId, takeover: true, at: now.toISOString() } },
      { userId: adminId, eventType: "project_ownership_transferred_in", previousValue: { ownerId: org.ownerId }, nextValue: { ownerId: adminId }, metadata: { projectId: orgId, previousOwnerId: org.ownerId, actorId: adminId, takeover: true, stepUpMethod, at: now.toISOString() } },
    ]);
    // Last changed records it (report §45.2).
    const [actor] = await tx.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, adminId)).limit(1);
    await tx.update(workspaces).set({ orgSettings: sql`jsonb_set(coalesce(${workspaces.orgSettings}, '{}'::jsonb), '{changes,ownership}', ${JSON.stringify({ by: adminId, byName: actor?.name ?? null, at: now.toISOString() })}::jsonb, true)` }).where(eq(workspaces.id, orgId));
    return { previousOwner: org.ownerId };
  });
  if ("error" in outcome) return outcome;
  const previousOwner = outcome.previousOwner;
  const org = await orgLabel(orgId);
  const name = (await db.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, adminId)).limit(1))[0]?.name ?? "An admin";
  if (org) {
    await notifyOrg({
      orgId, eventKey: "org.lifecycle", actorId: adminId, to: [previousOwner], title: `${name} took over ${org.title}. You’re an admin now.`,
      href: orgHref(org), sourceEventId: `takeover:${orgId}:${now.getTime()}`, email: { kind: "org_ownership" },
    });
  }
  return { ok: true as const };
}
