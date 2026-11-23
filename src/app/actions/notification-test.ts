"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { emailEnabled, recipientAllowed } from "@/lib/email/contracts";
import { sendResendEmail } from "@/lib/email/delivery";
import { logger } from "@/lib/logger";
import { buildTestEmail, TEST_PUSH } from "@/lib/notifications/test-send";
import { sendPushToUser } from "@/lib/notifications/web-push";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getAuthUser } from "@/lib/supabase/auth-user";

type Result = { success: true; detail: string } | { success: false; error: string };

/**
 * Settings › Notifications › Where it arrives › Send a test (settings mix): one email to your own address, or one
 * push to your own devices. Once a minute per channel. The email goes straight to Resend (no outbox row: a test has
 * nothing to retry and no kind of its own in the outbox).
 */
export async function sendTestNotificationAction(channel: "email" | "push"): Promise<Result> {
  if (channel !== "email" && channel !== "push") return { success: false, error: "Unknown channel" };
  const user = await getAuthUser();
  if (!user) return { success: false, error: "Sign in to continue" };
  const rate = await consumeRateLimit(`notification-test:${channel}:${user.id}`, 1, 60);
  if (!rate.allowed) return { success: false, error: "Wait a minute before sending another test." };
  try {
    if (channel === "push") {
      const sent = await sendPushToUser(user.id, { ...TEST_PUSH, id: randomUUID() }, { notificationId: null, topic: "settings-test", recordDeliveries: false });
      if (!sent.attempted) return { success: false, error: "No device has push turned on yet." };
      return sent.delivered ? { success: true, detail: `Sent to ${sent.delivered} device${sent.delivered === 1 ? "" : "s"}` } : { success: false, error: "Push didn’t reach your devices. Turn push off and on again." };
    }
    const [profile] = await db.select({ email: profiles.email, fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl }).from(profiles).where(eq(profiles.id, user.id)).limit(1);
    const email = profile?.email || user.email;
    if (!email) return { success: false, error: "This account has no email address." };
    if (!emailEnabled()) return { success: false, error: "Email isn’t switched on here." };
    if (!recipientAllowed(email)) return { success: false, error: "Test emails can’t go to this address here." };
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) return { success: false, error: "Email isn’t switched on here." };
    const sent = await sendResendEmail(buildTestEmail({ userId: user.id, email, name: profile?.fullName || profile?.username || "there", username: profile?.username ?? null, avatarUrl: profile?.avatarUrl ?? null }), `notification-test:${user.id}:${randomUUID()}`, key);
    return sent.ok ? { success: true, detail: `Sent to ${email}` } : { success: false, error: "The email didn’t send. Try again in a minute." };
  } catch (error) {
    logger.error("notification test failed", { channel, error: error instanceof Error ? error.message : String(error) });
    return { success: false, error: "Couldn’t send the test" };
  }
}
