import "server-only";

import { createHash } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { readBoundedBody } from "@/lib/security/bounded-body";
import { fetchProviderUrl, fetchPublicUrlWithRedirectValidation, GITHUB_API_HOSTS } from "@/lib/security/outbound-url";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { githubOrgOf, hostOf, linkUrls, ownWebsites, proofFound, type VerificationMethod } from "@/lib/organizations/trust-rules";

// Verified badge, four ways (2026-11-05-org-address-discovery-verification-findings.md §5, §7). Server only.

export const VERIFICATION_DOCUMENTS_BUCKET = "org-verification-documents";
/** D4: documents go 30 days after the team's decision. */
export const VERIFICATION_DOCUMENT_DAYS = 30;

/** What a pending request carries in org_settings.verificationRequest. Team review also sets verification_requested_at. */
export type VerificationRequest = {
  method: "team" | "parent";
  at: string;
  explanation?: string | null;
  links?: string[];
  document?: { key: string; name: string; size: number; type: string } | null;
  parentId?: string;
  parentTitle?: string;
};

/**
 * Way 3: the code an organization puts on its website, GitHub description or DNS. It only has to be unique per
 * organization (a code on acme.com proves nothing unless you control acme.com), so it needs no secret.
 */
export function proofCode(orgId: string) {
  return `networkbase-verify-${createHash("sha256").update(`org-verify:${orgId}`).digest("hex").slice(0, 20)}`;
}

/** Way 1: only the code's SHA-256 is kept, salted with the organization. */
export function hashVerifyCode(orgId: string, code: string) {
  return createHash("sha256").update(`${orgId}:${code.trim()}`).digest("hex");
}

/** Way 3, website: the home page of a website in Links (not GitHub or social pages) carries the code. */
export async function findCodeOnWebsite(links: unknown, code: string): Promise<string | null> {
  for (const url of ownWebsites(linkUrls(links)).slice(0, 3)) {
    const site = hostOf(url);
    if (!site) continue;
    try {
      const { response, release } = await fetchPublicUrlWithRedirectValidation({ url: `https://${site}/`, timeoutMs: 8_000, init: { headers: { "user-agent": "NetworkBase verification" } } });
      try {
        const { bytes } = await readBoundedBody(response, 512 * 1024);
        if (proofFound(new TextDecoder().decode(bytes), code)) return site;
      } finally {
        release();
      }
    } catch (error) {
      logger.info("org_verification.website_unreachable", { module: "trust", site, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return null;
}

/** Way 3, GitHub: the organization (or account) linked in Links has the code in its description or bio. */
export async function findCodeOnGithub(links: unknown, code: string): Promise<string | null> {
  const names = [...new Set(linkUrls(links).map(githubOrgOf).filter((n): n is string => Boolean(n)))].slice(0, 3);
  for (const name of names) {
    for (const path of [`/orgs/${name}`, `/users/${name}`]) {
      try {
        const response = await fetchProviderUrl(`https://api.github.com${path}`, GITHUB_API_HOSTS, { headers: { accept: "application/vnd.github+json", "user-agent": "NetworkBase verification" } }, 8_000);
        if (!response.ok) continue;
        const body = await response.json() as { description?: string | null; bio?: string | null; blog?: string | null };
        if (proofFound([body.description, body.bio, body.blog].filter(Boolean).join(" "), code)) return `github.com/${name}`;
        break;
      } catch (error) {
        logger.info("org_verification.github_unreachable", { module: "trust", name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return null;
}

/** Way 3, DNS: a TXT record on the domain of a website in Links holds the code. */
export async function findCodeInDns(links: unknown, code: string, resolve: typeof resolveTxt = resolveTxt): Promise<string | null> {
  const domains = [...new Set(ownWebsites(linkUrls(links)).map(hostOf).filter((d): d is string => Boolean(d)))].slice(0, 3);
  for (const domain of domains) {
    try {
      const records = await resolve(domain);
      if (records.some((parts) => proofFound(parts.join(""), code))) return domain;
    } catch {
      // No TXT records, or the domain doesn't resolve: try the next one.
    }
  }
  return null;
}

/** Marks an organization verified the given way and clears any pending request or past decline. */
export async function markVerified(orgId: string, method: VerificationMethod, against: string | null, options: { domain?: string | null; by?: string | null } = {}) {
  // Never a live-only org: one suspended, archived or deleted in the meantime gets no ✓ (security review, 5 Nov).
  const updated = await db.update(workspaces).set({
    verifiedAt: new Date(), verifiedBy: options.by ?? null, verificationMethod: method, verifiedAgainst: against,
    verificationDomain: options.domain ?? null, verificationRequestedAt: null,
    orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'verification' - 'verificationRequest'`,
  }).where(and(eq(workspaces.id, orgId), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt), isNull(workspaces.suspendedAt),
    sql`${workspaces.status} IS DISTINCT FROM 'archived'`)).returning({ id: workspaces.id });
  return updated.length > 0;
}

/**
 * A request's document goes as soon as the request does (Try another way, a new request, a parent ask), and an older
 * decision's document goes when the owner starts over — nothing is left in storage without a purge date.
 */
export async function discardVerificationDocuments(orgId: string, settings: unknown, options: { decided?: boolean } = {}) {
  const s = (settings ?? {}) as { verificationRequest?: VerificationRequest; verificationDocument?: { key?: string } };
  const keys = [s.verificationRequest?.document?.key, options.decided ? s.verificationDocument?.key : undefined].filter((k): k is string => Boolean(k));
  if (keys.length === 0) return;
  const admin = await createAdminClient();
  const { error } = await admin.storage.from(VERIFICATION_DOCUMENTS_BUCKET).remove(keys);
  if (error) logger.warn("org_verification.document_delete_failed", { module: "trust", orgId, error: error.message });
  if (options.decided) await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'verificationDocument'` }).where(eq(workspaces.id, orgId));
}

/**
 * D4: a team-review document stays 30 days after the decision, then goes. Runs daily with the download-history
 * retention job (no extra scheduled function).
 */
export async function purgeOrgVerificationDocuments(now = new Date()) {
  const rows = await db.select({ id: workspaces.id, doc: sql<{ key: string; decidedAt: string } | null>`${workspaces.orgSettings}->'verificationDocument'` })
    .from(workspaces)
    .where(and(eq(workspaces.kind, "organization"), isNotNull(sql`${workspaces.orgSettings}->'verificationDocument'->>'decidedAt'`),
      sql`(${workspaces.orgSettings}->'verificationDocument'->>'decidedAt')::timestamptz < ${new Date(now.getTime() - VERIFICATION_DOCUMENT_DAYS * 86_400_000).toISOString()}::timestamptz`))
    .limit(200);
  if (rows.length === 0) return 0;
  const admin = await createAdminClient();
  const keys = rows.map((r) => r.doc?.key).filter((k): k is string => Boolean(k));
  if (keys.length) {
    const { error } = await admin.storage.from(VERIFICATION_DOCUMENTS_BUCKET).remove(keys);
    if (error) throw new Error(`Couldn’t delete verification documents: ${error.message}`);
  }
  for (const row of rows) {
    await db.update(workspaces).set({ orgSettings: sql`${workspaces.orgSettings} - 'verificationDocument'` }).where(eq(workspaces.id, row.id));
  }
  return rows.length;
}

/** Way 2's Today rows for a parent's admins: organizations asking it to confirm them. */
export async function readParentAsks(parentId: string) {
  return db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, at: sql<string>`${workspaces.orgSettings}->'verificationRequest'->>'at'` })
    .from(workspaces)
    .where(and(eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt), isNull(workspaces.verifiedAt),
      sql`${workspaces.orgSettings}->'verificationRequest'->>'method' = 'parent'`, sql`${workspaces.orgSettings}->'verificationRequest'->>'parentId' = ${parentId}::text`))
    .limit(20);
}
