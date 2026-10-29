import { NextRequest } from "next/server";
import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { parseResendEvent, verifyResendEvent } from "@/lib/email/contracts";
import { recordResendEvent } from "@/lib/email/delivery";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const limited = await enforceRouteLimit(request, "api:v1:webhooks:resend", 600, 60);
  if (limited) return limited;
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return jsonError("Webhooks are not configured", 503, "UNAVAILABLE");
  const id = request.headers.get("svix-id") ?? "";
  if (!id || id.length > 200) return jsonError("Invalid delivery ID", 400, "BAD_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) return jsonError("Missing body", 400, "BAD_REQUEST");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 128 * 1024) {
        await reader.cancel();
        return jsonError("Payload too large", 413, "BAD_REQUEST");
      }
      chunks.push(value);
    }
  } catch {
    return jsonError("Couldn’t read body", 400, "BAD_REQUEST");
  } finally { reader.releaseLock(); }
  let verified: unknown;
  try {
    verified = verifyResendEvent(Buffer.concat(chunks).toString("utf8"), {
      "svix-id": id, "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    }, secret);
  } catch { return jsonError("Invalid signature", 401, "UNAUTHORIZED"); }
  // No tracking/inbound events: only the five registered delivery events are processed.
  if (!verified || typeof verified !== "object" || !("type" in verified)) return jsonError("Invalid event", 400, "BAD_REQUEST");
  if (!["email.sent", "email.delivered", "email.failed", "email.bounced", "email.complained"].includes(String(verified.type))) return jsonSuccess({ skipped: true });
  const parsed = parseResendEvent(verified);
  if (!parsed.success) return jsonError("Invalid event", 400, "BAD_REQUEST");
  try {
    await recordResendEvent(id, parsed.data);
    return jsonSuccess({ recorded: true });
  } catch { return jsonError("Couldn’t record event; retry delivery", 503, "UNAVAILABLE"); }
}
