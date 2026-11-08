import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getRequestIp, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { normalizeAuthNextPath, resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { db } from "@/lib/db";
import { queueEmail, wakeEmailWorker } from "@/lib/email/outbox";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { isTurnstileServerConfigured, verifyTurnstileToken } from "@/lib/security/turnstile";
import { createAdminClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  purpose: z.enum(["reset", "sign-in"]),
  captchaToken: z.string().trim().min(1).max(4096).optional(),
  next: z.string().max(2048).optional(),
});

/** The pages whose Cloudflare widget may ask for a code. */
const CODE_ACTIONS = ["login", "forgot-password"];
/**
 * Every answer takes at least this long, so an unknown address (answered early) can't be told apart from a real
 * account (a Supabase call and an email) by timing.
 */
const MIN_ANSWER_MS = 1_500;

/**
 * Sends a 6-digit code and a link for a password reset or a sign-in. Both work on any device: the browser that asked
 * keeps nothing the code needs. The answer is the same whether or not the account exists, so the page can't be used
 * to find out who has one.
 */
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter a valid email address.", 400, "BAD_REQUEST");
  const { email, purpose } = parsed.data;

  const ip = getRequestIp(request);
  const emailKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
  const [ipRate, emailRate] = await Promise.all([
    consumeRateLimit(`auth-email-code:ip:${ip}`, 10, 600),
    consumeRateLimit(`auth-email-code:email:${emailKey}`, 3, 600),
  ]);
  if (!ipRate.allowed || !emailRate.allowed) return jsonError("Too many codes asked for. Wait a few minutes and try again.", 429, "RATE_LIMITED");

  if (isTurnstileServerConfigured()) {
    if (!parsed.data.captchaToken) return jsonError("Complete the security check first.", 400, "BAD_REQUEST");
    const check = await verifyTurnstileToken({ token: parsed.data.captchaToken, ip, expectedAction: CODE_ACTIONS });
    if (!check.success) return jsonError("The security check didn’t pass. Wait for a new check, then try again.", 400, "BAD_REQUEST");
  }

  const startedAt = Date.now();
  try {
    // A sign-in code is only for an existing account: Supabase would make a new one for an unknown address.
    // ponytail: a confirmed account that never finished setup has no profile row yet, so it can't get a sign-in code; it can still reset its password.
    if (purpose === "sign-in") {
      const rows = await db.execute<{ found: number }>(sql`SELECT 1 AS found FROM public.profiles WHERE lower(email) = ${email} AND deleted_at IS NULL LIMIT 1`);
      if (rows.length === 0) return await sameAnswer(startedAt);
    }
    const admin = await createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: purpose === "reset" ? "recovery" : "magiclink", email });
    const code = data?.properties?.email_otp;
    const tokenHash = data?.properties?.hashed_token;
    if (error || !code || !tokenHash) return await sameAnswer(startedAt);

    const link = new URL("/auth/confirm", resolveAuthBaseUrl());
    link.searchParams.set("token_hash", tokenHash);
    link.searchParams.set("type", purpose === "reset" ? "recovery" : "magiclink");
    link.searchParams.set("next", purpose === "reset" ? "/reset-password" : normalizeAuthNextPath(parsed.data.next));
    await queueEmail(db, { kind: purpose === "reset" ? "auth_reset_code" : "auth_sign_in_code", eventId: randomUUID(), toEmail: email, data: { code, link: link.toString() } });
    await wakeEmailWorker();
  } catch (error) {
    logger.warn("auth.email_code.failed", { purpose, error: error instanceof Error ? error.message : String(error) });
  }
  return sameAnswer(startedAt);
}

async function sameAnswer(startedAt: number) {
  const wait = MIN_ANSWER_MS - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return jsonSuccess({ sent: true });
}
