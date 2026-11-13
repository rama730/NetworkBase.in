import { createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { legalAcceptances } from "@/lib/db/schema";
import { CURRENT_LEGAL_ACCEPTANCE } from "@/lib/legal/versions";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import { isTransientDbError, readDbErrorCode, withDbRetry } from "@/lib/db/retry";
import { logger } from "@/lib/logger";

const ACCEPTANCE_RETENTION_YEARS = 3;
const LEGAL_ACCEPTANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// ponytail: 1,000-entry in-memory cache of verified legal acceptances. ceiling: 1,000 active users per 5-minute window (~250KB RAM). upgrade: Upstash Redis key if concurrent active users exceed 1,000 per replica.
const LEGAL_ACCEPTANCE_CACHE_MAX_ENTRIES = 1000;
// How long past its TTL a verified acceptance may keep a user in during a database outage.
const LEGAL_ACCEPTANCE_OUTAGE_GRACE_MS = 15 * 60 * 1000;

interface CachedAcceptance {
  accepted: boolean;
  expiresAt: number;
  /** The document versions this entry was verified against. */
  versions: string;
}

const CURRENT_VERSIONS_KEY = `${CURRENT_LEGAL_ACCEPTANCE.termsVersion}|${CURRENT_LEGAL_ACCEPTANCE.eulaVersion}|${CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion}`;

/** AUTH-014: a database outage may extend only a recent, current-version, verified acceptance. */
export function acceptanceProvenDuringOutage(entry: CachedAcceptance | undefined, now = Date.now()) {
  return Boolean(entry?.accepted && entry.versions === CURRENT_VERSIONS_KEY && now < entry.expiresAt + LEGAL_ACCEPTANCE_OUTAGE_GRACE_MS);
}

export class LegalAcceptanceUnavailableError extends Error {
  constructor() {
    super("Your legal acceptance could not be checked right now. Try again.");
    this.name = "LegalAcceptanceUnavailableError";
  }
}

const legalAcceptanceCache = new Map<string, CachedAcceptance>();

function pruneLegalAcceptanceCacheIfNeeded() {
  if (legalAcceptanceCache.size < LEGAL_ACCEPTANCE_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of legalAcceptanceCache) {
    if (entry.expiresAt <= now) {
      legalAcceptanceCache.delete(key);
    }
  }
  while (legalAcceptanceCache.size >= LEGAL_ACCEPTANCE_CACHE_MAX_ENTRIES) {
    const oldestKey = legalAcceptanceCache.keys().next().value;
    if (oldestKey === undefined) break;
    legalAcceptanceCache.delete(oldestKey);
  }
}

export function setCachedLegalAcceptance(userId: string, accepted: boolean) {
  if (!userId) return;
  legalAcceptanceCache.delete(userId);
  pruneLegalAcceptanceCacheIfNeeded();
  legalAcceptanceCache.set(userId, {
    accepted,
    expiresAt: Date.now() + LEGAL_ACCEPTANCE_CACHE_TTL_MS,
    versions: CURRENT_VERSIONS_KEY,
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
  /** The person said they are 18 or older, on its own line apart from accepting the terms. */
  ageConfirmed?: boolean;
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
            ageConfirmed: input.ageConfirmed === true,
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
        const [row] = await db
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
      },
      { module: "legal" },
    );

    // The record of what was accepted and when, newest first (the person can read their own history).
    const history = await withDbRetry(
      "legal.getLegalAcceptanceHistory",
      () => db
        .select({
          termsVersion: legalAcceptances.termsVersion,
          eulaVersion: legalAcceptances.eulaVersion,
          privacyNoticeVersion: legalAcceptances.privacyNoticeVersion,
          context: legalAcceptances.context,
          acceptedAt: legalAcceptances.acceptedAt,
        })
        .from(legalAcceptances)
        .where(eq(legalAcceptances.userId, userId))
        .orderBy(desc(legalAcceptances.acceptedAt))
        .limit(10),
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

    return { current, latest: latest ?? null, history, versions: CURRENT_LEGAL_ACCEPTANCE };
  } catch (error) {
    logger.warn("legal.getLegalAcceptanceState_failed", {
      module: "legal",
      userId,
      errorCode: readDbErrorCode(error),
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      current: acceptanceProvenDuringOutage(legalAcceptanceCache.get(userId)),
      latest: null,
      history: [],
      versions: CURRENT_LEGAL_ACCEPTANCE,
    };
  }
}

export async function hasCurrentLegalAcceptance(userId: string): Promise<boolean> {
  if (!userId) return false;

  const now = Date.now();
  const cached = legalAcceptanceCache.get(userId);
  if (cached && cached.expiresAt > now && cached.versions === CURRENT_VERSIONS_KEY) {
    return cached.accepted;
  }

  try {
    const row = await withDbRetry(
      "legal.hasCurrentLegalAcceptance",
      async () => {
        const [result] = await db
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

    // A transient blip keeps out nobody who was recently verified, and lets in nobody unknown:
    // a cold user gets a retryable error instead of a pass.
    if (acceptanceProvenDuringOutage(cached, now)) return true;
    if (isTransientDbError(error)) throw new LegalAcceptanceUnavailableError();

    return false;
  }
}
