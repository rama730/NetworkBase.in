import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { fireDueTaskReminders, TASK_REMINDER_LIMIT } from "@/lib/domain/task-reminders";
import { DUE_MESSAGE_LIMIT, DUE_REMINDER_LIMIT, dueTimesWithinNextHour, fireDueReminders, sendDueScheduledMessages } from "@/lib/messaging/due";
import { auditChatIntegrity, purgeOldChatMentions } from "@/lib/messaging/maintenance";

import { inngest } from "../client";
import { wakeEvent } from "../wake";

export const CHAT_MENTIONS_RETENTION_JOB_ID = "chat-mentions-retention";
export const CHAT_INTEGRITY_AUDIT_JOB_ID = "chat-integrity-audit";
export const CHAT_DUE_JOB_ID = "chat-due";

async function heartbeat(jobId: string, payload: Record<string, unknown>) {
  const now = new Date();
  await db.insert(jobHeartbeats)
    .values({ jobId, lastSuccessAt: now, lastPayload: payload })
    .onConflictDoUpdate({ target: jobHeartbeats.jobId, set: { lastSuccessAt: now, lastPayload: payload, updatedAt: now } });
}

/** Activity keeps 90 days of mentions and thread replies. */
export const chatMentionsRetention = inngest.createFunction(
  { id: CHAT_MENTIONS_RETENTION_JOB_ID, retries: 2 },
  { cron: "15 4 * * *" },
  async ({ step }) => {
    let deleted = 0;
    let batch = 0;
    while (batch < 40) {
      const count = await step.run(`purge-${batch}`, () => purgeOldChatMentions(5_000));
      deleted += count;
      batch += 1;
      if (count < 5_000) break;
    }
    await step.run("write-heartbeat", () => heartbeat(CHAT_MENTIONS_RETENTION_JOB_ID, { deleted, batches: batch }));
    logger.info("chat.mentions.retention.completed", { module: "chat", deleted, count: batch });
    return { deleted, batches: batch };
  },
);

/** Daily sample of channel counters; problems are logged for follow-up, never auto-fixed. */
export const chatIntegrityAudit = inngest.createFunction(
  { id: CHAT_INTEGRITY_AUDIT_JOB_ID, retries: 1 },
  { cron: "40 4 * * *" },
  async ({ step }) => {
    const problems = await step.run("audit", () => auditChatIntegrity(200));
    if (problems.length) logger.error("chat.integrity.audit.problems", { module: "chat", count: problems.length, errors: problems.slice(0, 20) });
    await step.run("write-heartbeat", () => heartbeat(CHAT_INTEGRITY_AUDIT_JOB_ID, { problems: problems.length }));
    return { problems: problems.length };
  },
);

/**
 * Scheduled messages whose time has come, and "Remind me" reminders. Woken when one falls due; the hourly run catches a
 * lost wake and starts a run for everything due before the next one.
 */
export const chatDue = inngest.createFunction(
  { id: CHAT_DUE_JOB_ID, retries: 1, concurrency: { limit: 1 } },
  [{ event: "chat/due.wake" }, { cron: "15 * * * *" }],
  async ({ event, step }) => {
    const scheduled = await step.run("send-scheduled", () => sendDueScheduledMessages());
    const reminders = await step.run("fire-reminders", () => fireDueReminders());
    // Task reminders (report C2, 0088): the same job, so no new function or scheduled runs.
    const tasks = await step.run("fire-task-reminders", () => fireDueTaskReminders());
    // Meeting reminders (report 38.11 call 4, A4.1): the same job too.
    const docs = await step.run("fire-document-reminders", async () => (await import("@/lib/workflows/meeting-reminders")).fireDueDocumentReminders());
    // Scheduled Updates (report 38.17 call 2, A7.4): the same job, posting as their authors.
    const updates = await step.run("post-scheduled-updates", async () => (await import("@/lib/workflows/scheduled-updates-server")).fireDueScheduledUpdates());
    // More was due than one run takes: the rest goes now rather than at the next hourly run.
    if (scheduled.due >= DUE_MESSAGE_LIMIT || reminders.reminders >= DUE_REMINDER_LIMIT || tasks.due >= TASK_REMINDER_LIMIT || docs.docDue >= 200 || updates.scheduledUpdatesDue >= 50) await step.sendEvent("drain-more", { name: "chat/due.wake", data: {} });
    // Only the hourly run arms: this is the on-time guarantee for anything scheduled far ahead, so it uses Inngest's own retries.
    if (event.name !== "chat/due.wake") {
      // A1.6: "Ends in 3 days" for projects, once a project and end date (the hourly run only; dedupe keys hold).
      await step.run("projects-ending", async () => (await import("@/lib/workflows/planner-notify")).notifyProjectsEndingSoon());
      // A5.1b: "Check in on 3 key results" on each workspace's check-in day (dedupe keys hold).
      await step.run("goal-checkins", async () => (await import("@/lib/workflows/goals-notify")).notifyGoalCheckIns());
      await step.run("goals-closing", async () => (await import("@/lib/workflows/goals-notify")).notifyGoalsClosingSoon());
      // B1.2b (report 30.3 layer 15): "Mark 2 lessons taught" to each class's teacher, Summary, once a day.
      await step.run("lessons-to-mark", async () => (await import("@/lib/organizations/term-plan-server")).notifyLessonsToMarkTaught());
      // B3.2d (report 32.3 layer 15): "Lesson still Draft" to the teacher, once, within 3 school days of its session.
      await step.run("lessons-draft-soon", async () => (await import("@/lib/organizations/term-plan-server")).notifyDraftLessonsSoon());
      // B1.8c (report 30.6 layer 15): "No supervision in 30 days", Normal, once per gap, to the student and supervisor.
      await step.run("thesis-no-supervision", async () => (await import("@/lib/workflows/thesis-server")).notifyNoSupervision());
      // B2.3b (report 31.5 layer 15): Prep the day before; Off rhythm once per spell to the pair.
      await step.run("mentoring", async () => (await import("@/lib/organizations/mentoring-server")).notifyMentoring());
      // B3.1c (report 32.2 call 10): Next week at school, a Summary on the week's last school day after 3 PM.
      await step.run("school-week", async () => (await import("@/lib/organizations/school-events-server")).notifySchoolWeek());
      // B4.1 (report 33.2 layer 15): "2 handbook pages need review" in each page owner's weekly Summary.
      await step.run("handbook-review", async () => (await import("@/lib/organizations/handbook-server")).notifyHandbookReview());
      // B4.4 (report 33.5): onboarding starts for people who joined a company after its plan was switched on.
      await step.run("company-onboarding", async () => (await import("@/lib/organizations/company-onboarding-server")).sweepCompanyOnboarding());
      // B5.3b (report 34.4 layer 15): community event reminders to everyone Going, the day before and about an hour before.
      await step.run("community-event-reminders", async () => (await import("@/lib/organizations/community-server")).notifyCommunityEventReminders());
      // B5.4c (report 34.5 call 10): a challenge prompt opened — one line a day to the people who joined.
      await step.run("challenge-prompts", async () => (await import("@/lib/organizations/community-server")).notifyChallengePrompts());
      // B5.4d (report 34.5 call 7): community rituals post on schedule as Updates naming their host.
      await step.run("community-rituals", async () => (await import("@/lib/organizations/community-server")).postDueRituals());
      // B6.1c: lab memberships whose Leaving plan reached its end date end as Finished (or stay as Viewer).
      await step.run("lab-finish", async () => (await import("@/lib/organizations/lab-server")).finishDueLabMembers());
      // B6.4b (report 35.4 layer 15): the reading group's coming sessions, next-presenter, pick-by and late notices.
      await step.run("lab-reading-group", async () => (await import("@/lib/organizations/lab-reading-group-server")).readingGroupNotices());
      // B6.5b (report 35.6 layer 15): supervision due (a week past the rhythm) and milestones 30 and 7 days ahead.
      await step.run("lab-progress", async () => (await import("@/lib/organizations/lab-progress-server")).progressNotices());
      // B7.1b (report 36.2 layer 15): the Season renewal reminder at day 25 to members who haven't answered (once).
      await step.run("club-renewal", async () => (await import("@/lib/organizations/club-server")).renewalReminders());
      // B7.2c (report 36.3 call 10): the handover checklist opens three weeks before; on the date roles switch.
      await step.run("club-handover", async () => (await import("@/lib/organizations/club-server")).handoverSteps());
      const times = await step.run("due-times", () => dueTimesWithinNextHour());
      if (times.length) await step.sendEvent("arm-next-hour", times.map((at) => wakeEvent("chat/due.wake", new Date(at))));
    }
    if (scheduled.due || reminders.reminders) logger.info("chat.due.completed", { module: "chat", count: scheduled.sent + reminders.reminders });
    return { ...scheduled, ...reminders, ...tasks, ...docs, ...updates };
  },
);
