import "server-only";

import { sql } from "drizzle-orm";

import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { sendAs } from "@/lib/messaging/send";
import { chatFailure, chatRows, neutralChatCode } from "@/lib/messaging/server";
import { previewText } from "@/lib/messaging/tokens";
import { messageHref } from "@/lib/messaging/routes";

type DueMessage = { id: string; channel_id: string; user_id: string; body: string; thread_root_seq: number | null };

export const DUE_MESSAGE_LIMIT = 200;
export const DUE_REMINDER_LIMIT = 500;

// A claim is a lease, not a completion marker: an item counts as done only once
// delivered, and a crashed worker's claim simply expires (COR-010).
const CLAIM_LEASE = sql`interval '5 minutes'`;

/**
 * Send scheduled messages whose time has come. Rows are claimed with a short
 * lease (SKIP LOCKED, so overlapping runs never claim one twice) and marked
 * sent only after the send succeeded; a retry after a crash re-sends with the
 * same client id, which the message table dedupes. A send that fails (left the
 * channel, archived) keeps its row with the reason, for the sender.
 */
export async function sendDueScheduledMessages(limit = DUE_MESSAGE_LIMIT) {
  const due = await chatRows<DueMessage>(sql`
    UPDATE chat_scheduled_messages s SET claim_expires_at = now() + ${CLAIM_LEASE}
    WHERE s.id IN (
      SELECT id FROM chat_scheduled_messages
      WHERE sent_at IS NULL AND failed_reason IS NULL AND send_at <= now()
        AND (claim_expires_at IS NULL OR claim_expires_at < now())
      ORDER BY send_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING s.id, s.channel_id, s.user_id, s.body, s.thread_root_seq::int AS thread_root_seq
  `);
  let sent = 0;
  for (const row of due) {
    try {
      const result = await sendAs({ id: row.user_id }, { channelId: row.channel_id, body: row.body, threadRootSeq: row.thread_root_seq, clientId: `scheduled:${row.id}` }, null);
      if (!result.success) throw new Error(result.error);
      await chatRows(sql`UPDATE chat_scheduled_messages SET sent_at = now(), claim_expires_at = NULL WHERE id = ${row.id}::uuid`);
      sent += 1;
    } catch (error) {
      const reason = error instanceof Error && /^chat_[a-z_]+$/.test(error.message) ? neutralChatCode(error.message) : chatFailure(error, "scheduled_send").error;
      await chatRows(sql`UPDATE chat_scheduled_messages SET failed_reason = ${reason}, claim_expires_at = NULL WHERE id = ${row.id}::uuid`);
    }
  }
  return { due: due.length, sent };
}

type DueReminder = {
  user_id: string; channel_id: string; seq: number; thread_root_seq: number | null; body: string; remind_at: string;
  channel_name: string | null; channel_title: string | null; partner: string | null; author: string | null; eligible: boolean;
};

/** Where a reminder's message lives: "#design", a group's name, or the DM partner. */
export function reminderPlace(row: Pick<DueReminder, "channel_name" | "channel_title" | "partner">) {
  if (row.channel_name) return `#${row.channel_name}`;
  return row.channel_title || row.partner || null;
}

/**
 * What falls due before the next hourly sweep, as whole minutes: the sweep starts a run for each, because Inngest
 * limits how far ahead an event can start and a message may be scheduled months out.
 */
export async function dueTimesWithinNextHour(limit = 200) {
  const rows = await chatRows<{ at: string }>(sql`
    SELECT DISTINCT to_timestamp(ceil(extract(epoch FROM due.at) / 60) * 60) AS at FROM (
      SELECT send_at AS at FROM chat_scheduled_messages
      WHERE sent_at IS NULL AND failed_reason IS NULL AND send_at > now() AND send_at <= now() + interval '65 minutes'
      UNION ALL
      SELECT remind_at FROM chat_saved
      WHERE reminded_at IS NULL AND remind_at > now() AND remind_at <= now() + interval '65 minutes'
      UNION ALL
      -- Task reminders (report C2, 0088) ride the same job.
      SELECT remind_at FROM task_reminders
      WHERE sent_at IS NULL AND remind_at > now() AND remind_at <= now() + interval '65 minutes'
      UNION ALL
      -- Meeting reminders (report 38.11 call 4, A4.1).
      SELECT remind_at FROM workspace_document_reminders
      WHERE sent_at IS NULL AND remind_at > now() AND remind_at <= now() + interval '65 minutes'
    ) due
    ORDER BY at LIMIT ${limit}
  `);
  return rows.map((row) => new Date(row.at));
}

/** Fire "Remind me about this" as a notification linking back to the message. */
export async function fireDueReminders(limit = DUE_REMINDER_LIMIT) {
  const due = await chatRows<DueReminder>(sql`
    UPDATE chat_saved s SET reminder_claim_expires_at = now() + ${CLAIM_LEASE}
    FROM chat_messages m, chat_channels c
    WHERE (s.user_id, s.channel_id, s.message_seq) IN (
      SELECT user_id, channel_id, message_seq FROM chat_saved
      WHERE reminded_at IS NULL AND remind_at IS NOT NULL AND remind_at <= now()
        AND (reminder_claim_expires_at IS NULL OR reminder_claim_expires_at < now())
      ORDER BY remind_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) AND m.channel_id = s.channel_id AND m.channel_seq = s.message_seq AND c.id = s.channel_id
    RETURNING s.user_id, s.channel_id, s.message_seq::int AS seq, s.remind_at::text AS remind_at, m.thread_root_seq::int AS thread_root_seq, m.body, c.name AS channel_name, c.title AS channel_title,
              -- A DM or unnamed group is named by its other people.
              (SELECT string_agg(coalesce(pp.full_name, pp.username), ', ') FROM (
                 SELECT o.user_id FROM chat_channel_members o WHERE o.channel_id = s.channel_id AND o.user_id <> s.user_id ORDER BY o.joined_at LIMIT 3
               ) others JOIN profiles pp ON pp.id = others.user_id) AS partner,
              -- Left the conversation, or the message is gone: close the reminder without revealing it.
              (m.deleted_at IS NULL AND app_private.chat_is_member(s.channel_id, s.user_id)) AS eligible,
              (SELECT coalesce(pr.full_name, pr.username) FROM profiles pr WHERE pr.id = m.author_id) AS author
  `);
  const done = (row: DueReminder) => chatRows(sql`
    UPDATE chat_saved SET reminded_at = now(), reminder_claim_expires_at = NULL
    WHERE user_id = ${row.user_id}::uuid AND channel_id = ${row.channel_id}::uuid AND message_seq = ${row.seq}
      -- A reminder rescheduled while this one fired stays pending.
      AND remind_at = ${row.remind_at}::timestamptz
  `);
  let fired = 0;
  for (const row of due) {
    // Left the conversation, or the message is gone: close the reminder silently.
    if (!row.eligible) { await done(row); continue; }
    const preview = previewText(row.body).replace(/\s+/g, " ").trim().slice(0, 140);
    try {
      await createNotification({
        recipientUserId: row.user_id,
        kind: "chat_reminder",
        category: "mentions",
        importance: "important",
        title: `Reminder: ${row.author ?? "a message"}${reminderPlace(row) ? ` in ${reminderPlace(row)}` : ""}`,
        body: preview || null,
        href: messageHref(row.channel_id, row.seq, row.thread_root_seq),
        preview: { contextLabel: reminderPlace(row) ?? "Messages", contextKind: "workflow", secondaryText: "Saved" },
        // Stable per scheduled reminder, so a retry after a crash cannot notify twice.
        dedupeKey: `chat-reminder:${row.user_id}:${row.channel_id}:${row.seq}:${row.remind_at}`,
      });
      await done(row);
      fired += 1;
    } catch (error) {
      // The claim expires and the next run retries.
      logger.error("chat.reminder.failed", { module: "chat", error: String(error) });
    }
  }
  return { reminders: due.length, fired };
}
