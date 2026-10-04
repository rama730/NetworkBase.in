import "server-only";

import { sql } from "drizzle-orm";

import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { sendAs } from "@/lib/messaging/send";
import { chatFailure, chatRows } from "@/lib/messaging/server";
import { tokensToPlainText } from "@/lib/messaging/tokens";

type DueMessage = { id: string; channel_id: string; user_id: string; body: string; thread_root_seq: number | null };

/**
 * Send scheduled messages whose time has come. Rows are claimed with
 * SKIP LOCKED, so overlapping runs never send one twice. A send that fails
 * (left the channel, archived) keeps its row with the reason, for the sender.
 */
export async function sendDueScheduledMessages(limit = 200) {
  const due = await chatRows<DueMessage>(sql`
    UPDATE chat_scheduled_messages s SET sent_at = now()
    WHERE s.id IN (
      SELECT id FROM chat_scheduled_messages
      WHERE sent_at IS NULL AND failed_reason IS NULL AND send_at <= now()
      ORDER BY send_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING s.id, s.channel_id, s.user_id, s.body, s.thread_root_seq::int AS thread_root_seq
  `);
  let sent = 0;
  for (const row of due) {
    try {
      const result = await sendAs({ id: row.user_id }, { channelId: row.channel_id, body: row.body, threadRootSeq: row.thread_root_seq, clientId: `scheduled:${row.id}` }, null);
      if (!result.success) throw new Error(result.error);
      sent += 1;
    } catch (error) {
      const reason = error instanceof Error && /^chat_[a-z_]+$/.test(error.message) ? error.message : chatFailure(error, "scheduled_send").error;
      await chatRows(sql`UPDATE chat_scheduled_messages SET sent_at = NULL, failed_reason = ${reason} WHERE id = ${row.id}::uuid`);
    }
  }
  return { due: due.length, sent };
}

type DueReminder = { user_id: string; channel_id: string; seq: number; body: string; channel_name: string | null; author: string | null; eligible: boolean };

/** Fire "Remind me about this" as a notification linking back to the message. */
export async function fireDueReminders(limit = 500) {
  const due = await chatRows<DueReminder>(sql`
    UPDATE chat_saved s SET reminded_at = now()
    FROM chat_messages m, chat_channels c
    WHERE (s.user_id, s.channel_id, s.message_seq) IN (
      SELECT user_id, channel_id, message_seq FROM chat_saved
      WHERE reminded_at IS NULL AND remind_at IS NOT NULL AND remind_at <= now()
      ORDER BY remind_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) AND m.channel_id = s.channel_id AND m.channel_seq = s.message_seq AND c.id = s.channel_id
    RETURNING s.user_id, s.channel_id, s.message_seq::int AS seq, m.body, c.name AS channel_name,
              -- Left the conversation, or the message is gone: close the reminder without revealing it.
              (m.deleted_at IS NULL AND app_private.chat_is_member(s.channel_id, s.user_id)) AS eligible,
              (SELECT coalesce(pr.full_name, pr.username) FROM profiles pr WHERE pr.id = m.author_id) AS author
  `);
  for (const row of due.filter((reminder) => reminder.eligible)) {
    const preview = tokensToPlainText(row.body).replace(/\s+/g, " ").trim().slice(0, 140);
    await createNotification({
      recipientUserId: row.user_id,
      kind: "chat_reminder",
      category: "mentions",
      importance: "important",
      title: `Reminder: ${row.author ?? "a message"}${row.channel_name ? ` in #${row.channel_name}` : ""}`,
      body: preview || null,
      href: `/messages/${row.channel_id}?m=${row.seq}`,
      preview: { contextLabel: row.channel_name ? `#${row.channel_name}` : "Messages", contextKind: "workflow", secondaryText: "Saved for later" },
      dedupeKey: `chat-reminder:${row.user_id}:${row.channel_id}:${row.seq}:${Date.now()}`,
    }).catch((error) => logger.error("chat.reminder.failed", { module: "chat", error: String(error) }));
  }
  return { reminders: due.length };
}
