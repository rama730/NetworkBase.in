import { createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, readDb } from "@/lib/db";
import { legalAcceptances } from "@/lib/db/schema";
import { CURRENT_LEGAL_ACCEPTANCE } from "@/lib/legal/versions";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import { isTransientDbError, readDbErrorCode, withDbRetry } from "@/lib/db/retry";
import { logger } from "@/lib/logger";

const ACCEPTANCE_RETENTION_YEARS = 3;
const LEGAL_ACCEPTANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LEGAL_ACCEPTANCE_CACHE_MAX_ENTRIES = 5000;

interface CachedAcceptance {
  accepted: boolean;
  expiresAt: number;
}

const legalAcceptanceCache = new Map<string, CachedAcceptance>();

function pruneLegalAcceptanceCacheIfNeeded() {
  if (legalAcceptanceCache.size <= LEGAL_ACCEPTANCE_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of legalAcceptanceCache) {
    if (entry.expiresAt <= now) {
      legalAcceptanceCache.delete(key);
    }
  }
  if (legalAcceptanceCache.size <= LEGAL_ACCEPTANCE_CACHE_MAX_ENTRIES) return;
  const keysToDelete = Array.from(legalAcceptanceCache.keys()).slice(0, 500);
  for (const key of keysToDelete) {
    legalAcceptanceCache.delete(key);
  }
}

export function setCachedLegalAcceptance(userId: string, accepted: boolean) {
  if (!userId) return;
  pruneLegalAcceptanceCacheIfNeeded();
  legalAcceptanceCache.set(userId, {
    accepted,
    expiresAt: Date.now() + LEGAL_ACCEPTANCE_CACHE_TTL_MS,
  });
}

function evidenceHash(value: string | null) {
  if (!value) return null;
  const configuredKey = process.env.AUDIT_METADATA_HASH_SECRET?.trim();
  if (!configuredKey && process.env.NODE_ENV === "production") {
    throw new Error("AUDIT_METADATA_HASH_SECRET must be configured in production");
  }
  const globalScope = globalThis as typeof globalThis & {
    __NB_LEGAL_EVIDENCE_HASH_SECRET__?: string;
  };
  globalScope.__NB_LEGAL_EVIDENCE_HASH_SECRET__ ||= randomUUID();
  const key = configuredKey ?? globalScope.__NB_LEGAL_EVIDENCE_HASH_SECRET__;
  return createHmac("sha256", key).update(value).digest("hex");
}

export async function recordCurrentLegalAcceptance(input: {
  userId: string;
  request: Request;
  context: "email_signup" | "oauth_signup" | "settings" | "material_update";
}) {
  const acceptedAt = new Date();
  const retentionExpiresAt = new Date(acceptedAt);
  retentionExpiresAt.setUTCFullYear(retentionExpiresAt.getUTCFullYear() + ACCEPTANCE_RETENTION_YEARS);
  const ip = getTrustedRequestIp(input.request);
  const userAgent = input.request.headers.get("user-agent");

  const [row] = await withDbRetry(
    "legal.recordCurrentLegalAcceptance",
    async () => {
      return db
        .insert(legalAcceptances)
        .values({
          userId: input.userId,
          ...CURRENT_LEGAL_ACCEPTANCE,
          context: input.context,
          acceptedAt,
          retentionExpiresAt,
          evidence: {
            ipHash: evidenceHash(ip),
            userAgentHash: evidenceHash(userAgent),
            method: "affirmative_checkbox_or_button",
          },
        })
        .onConflictDoNothing()
        .returning();
    },
    { module: "legal" },
  );

  setCachedLegalAcceptance(input.userId, true);
  return row ?? null;
}

export async function getLegalAcceptanceState(userId: string) {
  try {
    const latest = await withDbRetry(
      "legal.getLegalAcceptanceState",
      async () => {
        try {
          const [row] = await readDb
            .select({
              termsVersion: legalAcceptances.termsVersion,
              eulaVersion: legalAcceptances.eulaVersion,
              privacyNoticeVersion: legalAcceptances.privacyNoticeVersion,
              context: legalAcceptances.context,
              acceptedAt: legalAcceptances.acceptedAt,
              retentionExpiresAt: legalAcceptances.retentionExpiresAt,
            })
            .from(legalAcceptances)
            .where(eq(legalAcceptances.userId, userId))
            .orderBy(desc(legalAcceptances.acceptedAt))
            .limit(1);
          return row;
        } catch (readError) {
          if (isTransientDbError(readError)) {
            const [fallbackRow] = await db
              .select({
                termsVersion: legalAcceptances.termsVersion,
                eulaVersion: legalAcceptances.eulaVersion,
                privacyNoticeVersion: legalAcceptances.privacyNoticeVersion,
                context: legalAcceptances.context,
                acceptedAt: legalAcceptances.acceptedAt,
                retentionExpiresAt: legalAcceptances.retentionExpiresAt,
              })
              .from(legalAcceptances)
              .where(eq(legalAcceptances.userId, userId))
              .orderBy(desc(legalAcceptances.acceptedAt))
              .limit(1);
            return fallbackRow;
          }
          throw readError;
        }
      },
      { module: "legal" },
    );

    const current = latest
      ? latest.termsVersion === CURRENT_LEGAL_ACCEPTANCE.termsVersion
        && latest.eulaVersion === CURRENT_LEGAL_ACCEPTANCE.eulaVersion
        && latest.privacyNoticeVersion === CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion
        && latest.retentionExpiresAt > new Date()
      : false;

    if (current) {
      setCachedLegalAcceptance(userId, true);
    }

    return { current, latest: latest ?? null, versions: CURRENT_LEGAL_ACCEPTANCE };
  } catch (error) {
    logger.warn("legal.getLegalAcceptanceState_failed", {
      module: "legal",
      userId,
      errorCode: readDbErrorCode(error),
      error: error instanceof Error ? error.message : String(error),
    });

    const cached = legalAcceptanceCache.get(userId);
    return {
      current: Boolean(cached?.accepted),
      latest: null,
      versions: CURRENT_LEGAL_ACCEPTANCE,
    };
  }
}

export async function hasCurrentLegalAcceptance(userId: string): Promise<boolean> {
  if (!userId) return false;

  const now = Date.now();
  const cached = legalAcceptanceCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.accepted;
  }

  try {
    const row = await withDbRetry(
      "legal.hasCurrentLegalAcceptance",
      async () => {
        try {
          const [result] = await readDb
            .select({ id: legalAcceptances.id })
            .from(legalAcceptances)
            .where(and(
              eq(legalAcceptances.userId, userId),
              eq(legalAcceptances.termsVersion, CURRENT_LEGAL_ACCEPTANCE.termsVersion),
              eq(legalAcceptances.eulaVersion, CURRENT_LEGAL_ACCEPTANCE.eulaVersion),
              eq(legalAcceptances.privacyNoticeVersion, CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion),
              gt(legalAcceptances.retentionExpiresAt, new Date()),
            ))
            .limit(1);
          return result;
        } catch (readError) {
          if (isTransientDbError(readError)) {
            const [fallbackResult] = await db
              .select({ id: legalAcceptances.id })
              .from(legalAcceptances)
              .where(and(
                eq(legalAcceptances.userId, userId),
                eq(legalAcceptances.termsVersion, CURRENT_LEGAL_ACCEPTANCE.termsVersion),
                eq(legalAcceptances.eulaVersion, CURRENT_LEGAL_ACCEPTANCE.eulaVersion),
                eq(legalAcceptances.privacyNoticeVersion, CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion),
                gt(legalAcceptances.retentionExpiresAt, new Date()),
              ))
              .limit(1);
            return fallbackResult;
          }
          throw readError;
        }
      },
      { module: "legal" },
    );

    const hasAccepted = Boolean(row);
    setCachedLegalAcceptance(userId, hasAccepted);
    return hasAccepted;
  } catch (error) {
    logger.warn("legal.hasCurrentLegalAcceptance_failed", {
      module: "legal",
      userId,
      errorCode: readDbErrorCode(error),
      error: error instanceof Error ? error.message : String(error),
    });

    // Graceful fallback for transient DB blips / pooler disconnects:
    // If user was previously verified (even within grace period), preserve access.
    if (cached?.accepted) {
      return true;
    }

    // On transient DB failure during cold start, do not crash the root layout
    if (isTransientDbError(error)) {
      return true;
    }

    return false;
  }
}
