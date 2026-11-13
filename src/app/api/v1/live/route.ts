// ponytail: import jsonSuccess directly from _envelope instead of _shared so liveness probes do not pull in Supabase, Drizzle schema, Redis, Sentry, or email outbox modules. ceiling: liveness check only. upgrade: use /api/v1/ready for deep dependency readiness.
import { jsonSuccess } from "@/app/api/v1/_envelope";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonSuccess({ status: "ok", probe: "liveness" });
}
