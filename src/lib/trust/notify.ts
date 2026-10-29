import "server-only";

import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";

// Safety notices in the tray (T16–T23, C19): one kind, always delivered, never naming who reported.

export async function notifySafety(input: { to: string | null | undefined; title: string; body?: string | null; href?: string | null; dedupeKey: string }) {
  if (!input.to) return;
  try {
    await createNotification({
      recipientUserId: input.to,
      kind: "trust_safety",
      category: "projects",
      importance: "important",
      title: input.title.slice(0, 240),
      body: input.body?.slice(0, 1000) ?? null,
      href: input.href ?? "/settings#settings-account",
      dedupeKey: `trust:${input.dedupeKey}`,
    });
  } catch (error) {
    logger.warn("trust.notice_failed", { module: "trust", error: error instanceof Error ? error.message : String(error) });
  }
}
