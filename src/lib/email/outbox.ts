import { db } from "@/lib/db";
import { emailOutbox } from "@/lib/db/schema";
import { sendHint } from "@/inngest/wake";
import { logger } from "@/lib/logger";
import { assignmentRecipient, emailEnabled, emailEventKey, type EmailKind } from "./contracts";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One email per event per person: the event key makes replays a no-op. `toEmail` is only for invitations to an address without an account. */
type QueuedEmail = {
  kind: EmailKind; eventId: string; userId?: string | null; toEmail?: string | null; actorId?: string; taskId?: string; projectId?: string;
  data?: Record<string, unknown>;
};

export async function queueEmail(tx: Executor, input: QueuedEmail) {
  await queueEmails(tx, [input]);
}

/** Many recipients in a few statements (an org-wide assignment is 2,000 rows). */
export async function queueEmails(tx: Executor, inputs: QueuedEmail[]) {
  if (!emailEnabled()) return;
  const rows = inputs.flatMap((input) => {
    const recipient = input.userId ?? input.toEmail?.toLowerCase();
    if (!recipient) return [];
    if (input.kind === "task_assignment" && !assignmentRecipient(input.actorId!, input.userId)) return [];
    return [{
      eventKey: emailEventKey(input.kind, input.eventId, recipient),
      kind: input.kind, userId: input.userId ?? null, toEmail: input.userId ? null : recipient, actorId: input.actorId,
      taskId: input.taskId, projectId: input.projectId, data: input.data,
    }];
  });
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(emailOutbox).values(rows.slice(i, i + 500)).onConflictDoNothing({ target: emailOutbox.eventKey });
  }
}

/** A wake-up is only a hint: committed work survives an unavailable Inngest API. */
export async function wakeEmailWorker() {
  if (!emailEnabled()) return;
  await sendHint({ name: "email/outbox.wake", data: {} });
}
