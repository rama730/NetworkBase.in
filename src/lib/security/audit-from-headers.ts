import "server-only";

import { headers } from "next/headers";

import { logger } from "@/lib/logger";
import { recordSecurityEvent } from "@/lib/security/audit";

/** For server actions, which have no Request: the fingerprint is built from the incoming headers. Never throws. */
export async function recordSecurityEventFromHeaders(input: Omit<Parameters<typeof recordSecurityEvent>[0], "request">) {
  try {
    const request = new Request("https://networkbase.invalid/", { headers: new Headers(await headers()) });
    await recordSecurityEvent({ ...input, request });
  } catch (error) {
    logger.warn("security.audit.from_headers_failed", { module: "security", eventType: input.eventType, error: error instanceof Error ? error.message : String(error) });
  }
}
