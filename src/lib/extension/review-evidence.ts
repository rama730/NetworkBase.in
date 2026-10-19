import { z } from "zod";
/** Local check results are signed-in-client reports, never server test attestations or owner approval. */
export const extensionReviewEvidenceSchema = z.object({
  summary: z.string().max(3000),
  issues: z.string().max(3000).default(""),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  checks: z
    .array(
      z.object({
        id: z.string().uuid(),
        taskName: z.string().max(200),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        startedAt: z.number().nonnegative(),
        endedAt: z.number().nonnegative(),
        exitCode: z.number().int().optional(),
        terminated: z.boolean().optional(),
      }),
    )
    .max(50),
  receipts: z
    .array(
      z.object({
        nodeId: z.string().uuid(),
        operationId: z.string().uuid(),
        version: z.number().int().positive(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(200),
});
export function classifyReportedCheck(
  check: { fingerprint: string; exitCode?: number; terminated?: boolean },
  fingerprint: string,
) {
  if (check.fingerprint !== fingerprint) return "stale";
  if (check.terminated) return "cancelled";
  if (check.exitCode === undefined) return "unknown";
  return check.exitCode === 0 ? "reported_pass" : "reported_failure";
}
