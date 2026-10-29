import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { getInngestExecutionRole } from "@/inngest/registry";
import { emailOutbox, emailSuppressions, emailWebhookEvents, extensionDeviceSessions, profiles, projectMembers, projects, tasks, taskSubtasks, projectNodes, taskNodeLinks } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { normalizeNotificationPreferences } from "@/lib/notifications/preferences";
import { resolveNotificationDeliveryPolicy } from "@/lib/notifications/service";
import { isWorkspaceMemberEligibleFor } from "@/lib/workspaces/collaborator-lifecycle";
import { resolveWorkspaceNotificationDecision, normalizeWorkspaceNotificationPolicy, normalizeWorkspaceMemberNotificationOverrides } from "@/lib/notifications/workspace-policy";
import { resolveIdeFromSession, SUPPORTED_IDES } from "@/lib/extension/ide-protocol";
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { ALWAYS_SENT_EMAILS, buildOrgEmail, orgMuteToken, type OrgEmailData } from "./org-templates";
import { orgChoiceFor } from "@/lib/notifications/preferences";
import { buildSecurityEmail, isDeletionEmailKind, isSecurityEmailKind, type SecurityEmailData } from "./security-templates";
import {
  buildEmail, type OrgEmailKind, DELIVERY_RANK, emailEnabled, eventDeliveryState, recipientAllowed,
  MAX_ATTEMPTS, RETRY_WINDOW_MS, retryDecision, suppressionReason, type EmailPayload, type ResendEvent,
} from "./contracts";

type OutboxRow = typeof emailOutbox.$inferSelect;
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function currentDeliveryState(tx: Executor, providerId: string) {
  const events = await tx.select({ state: emailWebhookEvents.state }).from(emailWebhookEvents)
    .where(eq(emailWebhookEvents.providerId, providerId));
  return events.reduce((state, event) => DELIVERY_RANK[event.state] > DELIVERY_RANK[state] ? event.state : state, "accepted" as NonNullable<OutboxRow["deliveryState"]>);
}

/** Serialize receipt and send-response reconciliation even if the receipt arrives first. */
export async function recordResendEvent(id: string, event: ResendEvent) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${event.data.email_id}, 0))`);
    const inserted = await tx.insert(emailWebhookEvents).values({
      id, providerId: event.data.email_id, state: eventDeliveryState(event), occurredAt: new Date(event.created_at),
    }).onConflictDoNothing().returning({ id: emailWebhookEvents.id });
    if (!inserted.length) return;
    const reason = suppressionReason(event);
    if (reason) {
      await tx.insert(emailSuppressions).values(event.data.to.map((email) => ({ email: email.toLowerCase(), reason })))
        .onConflictDoNothing();
    }
    await tx.update(emailOutbox).set({
      deliveryState: await currentDeliveryState(tx, event.data.email_id), updatedAt: new Date(),
    }).where(eq(emailOutbox.providerId, event.data.email_id));
  });
  logger.metric("email.webhook", { module: "email", deliveryId: id, eventType: event.type });
}

type Prepared = { drop: string } | { delay: Date } | { payload: EmailPayload };

async function addressBlocked(email: string) {
  if (!recipientAllowed(email)) return "nonproduction_recipient_not_allowlisted";
  if (await db.query.emailSuppressions.findFirst({ where: eq(emailSuppressions.email, email), columns: { email: true } })) return "suppressed";
  return null;
}

const MEMBER_EMAILS = new Set(["org_welcome", "org_assignment", "org_due_soon", "org_overdue", "org_returned", "org_announcement", "org_digest", "org_ended"]);

/** Org emails E1–E14 (report §26.5): preferences and the org's own choices are read at send time, not queue time. */
async function prepareOrgEmail(row: OutboxRow, userId: string, email: string, rawPreferences: unknown): Promise<Prepared> {
  const kind = row.kind as OrgEmailKind;
  const data = row.data as OrgEmailData | null;
  if (!data?.org?.id) return { drop: "invalid_org_context" };
  // A suspended org sends nothing (report §30.3); the owner hears why in the tray.
  const [orgState] = await db.select({ suspendedAt: projects.suspendedAt }).from(projects).where(eq(projects.id, data.org.id)).limit(1);
  if (orgState?.suspendedAt) return { drop: "org_suspended" };
  const preferences = normalizeNotificationPreferences(rawPreferences);
  if (!ALWAYS_SENT_EMAILS.has(kind)) {
    if (!preferences.delivery.email) return { drop: "email_opt_out" };
    const choice = orgChoiceFor(preferences, data.org.id);
    if (!choice.email || choice.level === "off") return { drop: "org_email_off" };
    if (preferences.mutedScopes.some((scope) => scope.kind === "organization" && scope.value === data.org.id)) return { drop: "muted_scope" };
  }
  if (MEMBER_EMAILS.has(kind)) {
    const [member] = await db.select({ ok: sql<number>`1` }).from(projects)
      .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
      .where(and(eq(projects.id, data.org.id), isNull(projects.deletedAt), sql`(${projects.ownerId} = ${userId} OR ${projectMembers.userId} IS NOT NULL)`)).limit(1);
    if (!member) return { drop: "membership_changed" };
  }
  const token = orgMuteToken(userId, data.org.id);
  const muteUrl = token ? new URL(`/api/v1/email/org-mute?token=${encodeURIComponent(token)}`, resolveAuthBaseUrl()).toString() : null;
  return { payload: row.payload ?? buildOrgEmail(kind, { ...data, timeZone: data.timeZone ?? preferences.quietHours.timeZone ?? null }, { email, muteUrl }) };
}

async function prepareEmail(row: OutboxRow): Promise<Prepared> {
  if (!row.userId) {
    // E3: an invitation to an address without an account. Only bounce blocking and the test allowlist apply.
    // Two kinds go to an address with no account: an invitation to join, and the confirmation that an account was deleted.
    if (row.kind === "account_deletion_completed" && row.toEmail) {
      const email = row.toEmail.toLowerCase();
      const blocked = await addressBlocked(email);
      if (blocked) return { drop: blocked };
      return { payload: row.payload ?? buildSecurityEmail("account_deletion_completed", {}, { email, name: "there" }) };
    }
    if (row.kind !== "org_invite_signup" || !row.toEmail || !row.data) return { drop: "invalid_recipient" };
    const email = row.toEmail.toLowerCase();
    const blocked = await addressBlocked(email);
    if (blocked) return { drop: blocked };
    return { payload: row.payload ?? buildOrgEmail("org_invite_signup", row.data as OrgEmailData, { email }) };
  }
  const userId = row.userId;
  const profile = await db.query.profiles.findFirst({
    // A scheduled deletion hides the profile, and the deletion emails are the ones that must still reach it.
    where: and(eq(profiles.id, userId), isDeletionEmailKind(row.kind) ? undefined : isNull(profiles.deletedAt)),
    columns: {
      id: true,
      fullName: true,
      username: true,
      avatarUrl: true,
      headline: true,
      skills: true,
      notificationPreferences: true,
      onboardingStatus: true,
    },
  });
  if (!profile) return { drop: "account_inactive" };
  const admin = await createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404) return { drop: "account_missing" };
    throw new Error("recipient_lookup_unavailable");
  }
  const user = data.user;
  if (!user?.email || !user.email_confirmed_at || (user.banned_until && Date.parse(user.banned_until) > Date.now())) {
    return { drop: "recipient_unverified_or_inactive" };
  }
  const email = user.email.toLowerCase();
  if (row.payload && row.payload.to[0]?.toLowerCase() !== email) return { drop: "recipient_changed" };
  const blocked = await addressBlocked(email);
  if (blocked) return { drop: blocked };
  if (row.kind.startsWith("org_")) return prepareOrgEmail(row, userId, email, profile.notificationPreferences);
  if (isSecurityEmailKind(row.kind)) {
    // About the account itself: no email switch, no mutes. Bounce blocking and the allowlist above still apply.
    return { payload: row.payload ?? buildSecurityEmail(row.kind, (row.data ?? {}) as SecurityEmailData, { email, name: profile.fullName || "there", username: profile.username, avatarUrl: profile.avatarUrl, userId: profile.id }) };
  }
  if (row.kind === "welcome") {
    if (profile.onboardingStatus !== "completed") return { drop: "onboarding_incomplete" };
    return {
      payload: row.payload ?? buildEmail({
        kind: "welcome",
        email,
        name: profile.fullName || "there",
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        headline: profile.headline,
        skills: profile.skills,
        userId: profile.id,
      }),
    };
  }
  if (!row.taskId || !row.projectId) return { drop: "invalid_task_context" };
  const assigneeProfile = alias(profiles, "assignee_profile");
  const actorProfile = alias(profiles, "actor_profile");
  const [context] = await db.select({
    task: {
      assigneeId: tasks.assigneeId,
      title: tasks.title,
      priority: tasks.priority,
      status: tasks.status,
      taskNumber: tasks.taskNumber,
      dueDate: tasks.dueDate,
    },
    project: {
      ownerId: projects.ownerId,
      title: projects.title,
      slug: projects.slug,
      notificationPreferences: projects.notificationPreferences,
    },
    assignee: {
      id: assigneeProfile.id,
      fullName: assigneeProfile.fullName,
      username: assigneeProfile.username,
      avatarUrl: assigneeProfile.avatarUrl,
      headline: assigneeProfile.headline,
    },
    actor: {
      id: actorProfile.id,
      fullName: actorProfile.fullName,
      username: actorProfile.username,
    },
    member: { role: projectMembers.role, notificationPreferences: projectMembers.notificationPreferences },
  })
    .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .leftJoin(assigneeProfile, eq(assigneeProfile.id, tasks.assigneeId))
    .leftJoin(actorProfile, row.actorId ? eq(actorProfile.id, row.actorId) : sql`false`)
    .where(and(eq(tasks.id, row.taskId), eq(tasks.projectId, row.projectId), isNull(tasks.deletedAt), isNull(projects.deletedAt))).limit(1);
  if (!context || context.task.assigneeId !== row.userId ||
    (context.project.ownerId !== row.userId && !context.member?.role) || !isWorkspaceMemberEligibleFor(
    context.project.ownerId === row.userId ? "owner" : context.member?.role, "assign",
  )) {
    return { drop: "assignment_or_access_changed" };
  }
  // A→B→A queued before the worker runs must not send the obsolete first A event.
  const latestAssignment = await db.query.taskActivityEvents.findFirst({
    where: (t, { and, eq }) => and(eq(t.taskId, row.taskId!), eq(t.eventType, "assigned"), sql`${t.payload}->>'version' = '2'`),
    orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)], columns: { id: true },
  });
  const source = row.eventKey.split(":")[1];
  if (latestAssignment && source !== latestAssignment.id) {
    return { drop: "assignment_superseded" };
  }
  const preferences = normalizeNotificationPreferences(profile.notificationPreferences);
  if (!preferences.delivery.email) return { drop: "email_opt_out" };
  const projectPolicy = resolveWorkspaceNotificationDecision({
    eventKey: source === `${row.taskId}-created` ? "tasks.created_assigned" : "tasks.assigned",
    projectPolicy: normalizeWorkspaceNotificationPolicy(context.project.notificationPreferences),
    memberOverrides: normalizeWorkspaceMemberNotificationOverrides(context.member?.notificationPreferences),
  });
  if (!projectPolicy.enabled) return { drop: "project_policy_off" };
  const check = resolveNotificationDeliveryPolicy({
    recipientUserId: row.userId, actorUserId: row.actorId, kind: "task_assigned", category: "tasks",
    entityRefs: { taskId: row.taskId, projectId: row.projectId }, preferenceMap: new Map([[row.userId, preferences]]),
  });
  if (!check.allowed) return { drop: check.reason };
  if (check.delayUntil) return { delay: check.delayUntil };

  const [subtasksRows, fileRows] = await Promise.all([
    db.select({
      id: taskSubtasks.id,
      title: taskSubtasks.title,
      completed: taskSubtasks.completed,
    })
      .from(taskSubtasks)
      .where(eq(taskSubtasks.taskId, row.taskId))
      .orderBy(asc(taskSubtasks.position), asc(taskSubtasks.id))
      .limit(20),

    db.select({
      id: projectNodes.id,
      name: projectNodes.name,
      size: projectNodes.size,
      mimeType: projectNodes.mimeType,
      annotation: taskNodeLinks.annotation,
      metadata: projectNodes.metadata,
    })
      .from(projectNodes)
      .leftJoin(taskNodeLinks, and(eq(taskNodeLinks.nodeId, projectNodes.id), eq(taskNodeLinks.taskId, row.taskId)))
      .where(and(
        eq(projectNodes.projectId, row.projectId),
        isNull(projectNodes.deletedAt),
        eq(projectNodes.type, "file"),
        sql`(${projectNodes.taskId} = ${row.taskId} OR ${taskNodeLinks.id} IS NOT NULL)`
      ))
      .orderBy(asc(projectNodes.name))
      .limit(10),
  ]);

  const subtaskIds = new Set(subtasksRows.map((s) => s.id));
  const filesBySubtask = new Map<string, Array<{ id?: string; name: string; size?: number; mimeType?: string }>>();
  const generalFiles: Array<{ id?: string; name: string; size?: number; mimeType?: string }> = [];

  for (const f of fileRows) {
    const fileItem = {
      id: f.id,
      name: f.name,
      size: Number(f.size ?? 0),
      mimeType: f.mimeType ?? undefined,
    };
    let matchedSubtaskId: string | null = null;
    const metaSubtaskId = typeof f.metadata?.subtaskId === "string" ? f.metadata.subtaskId : null;
    if (metaSubtaskId && subtaskIds.has(metaSubtaskId)) {
      matchedSubtaskId = metaSubtaskId;
    } else if (f.annotation) {
      const match = f.annotation.match(/#?subtask:([a-f0-9-]+)/i);
      if (match && match[1] && subtaskIds.has(match[1])) {
        matchedSubtaskId = match[1];
      }
    }

    if (matchedSubtaskId) {
      const existing = filesBySubtask.get(matchedSubtaskId) ?? [];
      existing.push(fileItem);
      filesBySubtask.set(matchedSubtaskId, existing);
    } else {
      generalFiles.push(fileItem);
    }
  }

  const now = new Date();
  const activeSession = await db.query.extensionDeviceSessions.findFirst({
    where: and(
      eq(extensionDeviceSessions.userId, row.userId),
      isNull(extensionDeviceSessions.revokedAt),
      gt(extensionDeviceSessions.expiresAt, now),
    ),
    orderBy: [
      desc(extensionDeviceSessions.lastSeenAt),
      desc(extensionDeviceSessions.id),
    ],
    columns: { editorName: true, editorPlatform: true },
  });

  let connectedDesktopIde: { name: string; scheme?: string; launchUrl?: string } | null = null;
  if (activeSession) {
    const ide = resolveIdeFromSession(activeSession);
    const ideDef = SUPPORTED_IDES[ide];
    const origin = resolveAuthBaseUrl();
    const launchParams = new URLSearchParams({
      projectId: row.projectId,
      slug: context.project.slug || row.projectId,
      taskId: row.taskId,
      ide,
    });
    const launchUrl = new URL(`/open/ide?${launchParams.toString()}`, origin).toString();
    connectedDesktopIde = {
      name: ideDef?.name || "Code editor",
      scheme: ideDef?.scheme || ide,
      launchUrl,
    };
  }

  return { payload: row.payload ?? buildEmail({
    kind: "task_assignment",
    email,
    name: profile.fullName || "there",
    taskTitle: context.task.title,
    projectTitle: context.project.title,
    taskId: row.taskId,
    projectSlug: context.project.slug || row.projectId,
    taskNumber: context.task.taskNumber,
    priority: context.task.priority,
    status: context.task.status,
    dueDate: context.task.dueDate,
    assigneeName: context.assignee?.fullName || profile.fullName || "there",
    assigneeUsername: context.assignee?.username,
    assigneeAvatarUrl: context.assignee?.avatarUrl,
    assigneeHeadline: context.assignee?.headline,
    assigneeId: context.assignee?.id || context.task.assigneeId,
    assignerName: context.actor?.fullName || null,
    assignerUsername: context.actor?.username || null,
    connectedDesktopIde,
    subtasks: subtasksRows.map((s) => ({
      id: s.id,
      title: s.title,
      completed: Boolean(s.completed),
      files: filesBySubtask.get(s.id) ?? [],
    })),
    files: generalFiles,
  }) };
}

/** Pure transport boundary, also exercised with mocked fetch (never real recipients in tests). */
export async function sendResendEmail(payload: EmailPayload, idempotencyKey: string, key: string, fetcher = fetch) {
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      // JSONB does not preserve property order. Serialize in a fixed order so
      // retries use exactly the same request bytes, not just equivalent JSON.
      body: JSON.stringify({
        from: payload.from,
        to: payload.to,
        reply_to: payload.reply_to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        ...(payload.attachments && payload.attachments.length > 0 ? {
          attachments: payload.attachments.map((att) => ({
            filename: att.filename,
            ...(att.content ? { content: att.content } : {}),
            ...(att.path ? { path: att.path } : {}),
            ...(att.content_id ? { content_id: att.content_id } : {}),
          })),
        } : {}),
      }),
    });
    if (!response.ok) return { ok: false as const, retryable: response.status === 429 || response.status >= 500 || response.status === 408 || response.status === 409,
      error: `resend_http_${response.status}`, retryAfter: response.headers.get("retry-after") };
    const data: unknown = await response.json();
    const id = data && typeof data === "object" && "id" in data ? data.id : null;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false as const, retryable: true, error: "resend_invalid_response", retryAfter: null };
    return { ok: true as const, id };
  } catch {
    return { ok: false as const, retryable: true, error: "resend_network_or_timeout", retryAfter: null };
  }
}

export async function drainEmailOutbox() {
  if (!emailEnabled()) return { processed: 0 };
  if (getInngestExecutionRole() !== "worker") throw new Error("Email delivery must run on the worker");
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY is required when email delivery is enabled");
  let processed = 0;
  // ponytail: sequential batches of 25, one worker run at a time. Ceiling: low-volume transactional mail; upgrade to rate-aware parallel batches if queue age grows.
  while (processed < 25 && emailEnabled()) {
    const leaseId = randomUUID();
    const claimed = await db.execute<{ id: string }>(sql`
      UPDATE public.email_outbox SET status = 'processing', lease_id = ${leaseId}::uuid,
        lease_expires_at = now() + interval '5 minutes', updated_at = now()
      WHERE id = (SELECT id FROM public.email_outbox
        WHERE (status = 'pending' AND due_at <= now()) OR (status = 'processing' AND lease_expires_at < now())
        ORDER BY due_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id`);
    const id = claimed[0]?.id;
    if (!id) break;
    const row = await db.query.emailOutbox.findFirst({ where: eq(emailOutbox.id, id) });
    if (!row) continue;
    const owned = and(eq(emailOutbox.id, id), eq(emailOutbox.leaseId, leaseId));
    const finish = async (changes: Partial<typeof emailOutbox.$inferInsert>) => {
      await db.update(emailOutbox).set({ ...changes, leaseId: null, leaseExpiresAt: null, updatedAt: new Date() }).where(owned);
    };
    processed++;
    if (row.attempts >= MAX_ATTEMPTS || (row.firstAttemptAt && Date.now() >= row.firstAttemptAt.getTime() + RETRY_WINDOW_MS)) {
      const reason = row.attempts >= MAX_ATTEMPTS ? "attempt_limit_exhausted" : "idempotency_window_exhausted";
      await finish({ status: "needs_review", lastError: reason });
      logger.error("email.needs_review", { module: "email", deliveryId: id, reason });
      continue;
    }
    let prepared: Awaited<ReturnType<typeof prepareEmail>>;
    try { prepared = await prepareEmail(row); } catch {
      await finish({ status: "pending", dueAt: new Date(Date.now() + 5 * 60_000), lastError: "recipient_lookup_unavailable" });
      logger.warn("email.lookup_failed", { module: "email", deliveryId: id });
      continue;
    }
    if ("drop" in prepared) {
      await finish({ status: "dropped", lastError: prepared.drop });
      logger.metric("email.dropped", { module: "email", deliveryId: id, reason: prepared.drop });
      continue;
    }
    if ("delay" in prepared) {
      await finish({ status: "pending", dueAt: prepared.delay, lastError: null });
      continue;
    }
    const firstAttemptAt = row.firstAttemptAt ?? new Date();
    const attempts = row.attempts + 1;
    if (Date.now() >= firstAttemptAt.getTime() + RETRY_WINDOW_MS) {
      await finish({ status: "needs_review", lastError: "idempotency_window_exhausted" });
      continue;
    }
    // Freeze before the network call: restart/timeouts cannot change the retried request.
    const saved = await db.update(emailOutbox).set({ payload: prepared.payload, attempts, firstAttemptAt })
      .where(owned).returning({ id: emailOutbox.id });
    if (!saved.length) continue;
    const result = await sendResendEmail(prepared.payload, `networkbase/${id}`, key);
    if (result.ok) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${result.id}, 0))`);
        await tx.update(emailOutbox).set({
          status: "accepted", providerId: result.id, deliveryState: await currentDeliveryState(tx, result.id),
          lastError: null, leaseId: null, leaseExpiresAt: null, updatedAt: new Date(),
        }).where(owned);
      });
      logger.metric("email.accepted", { module: "email", deliveryId: id, attempt: attempts });
    } else {
      const dueAt = result.retryable ? retryDecision(attempts, firstAttemptAt, new Date(), result.retryAfter) : null;
      const status = dueAt ? "pending" : result.retryable ? "needs_review" : "failed";
      await finish({ status, dueAt: dueAt ?? row.dueAt, lastError: result.error });
      logger.warn("email.send_failed", { module: "email", deliveryId: id, status, reason: result.error, attempt: attempts });
    }
  }
  return { processed };
}
