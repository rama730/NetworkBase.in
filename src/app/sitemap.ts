import type { MetadataRoute } from "next";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, workspaces } from "@/lib/db/schema";
import { discoverListedSql, orgIndexableSql } from "@/lib/discover/listed-sql";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import { logger } from "@/lib/logger";
import { readableProfileIdentitySql } from "@/lib/privacy/resolver";

// Read per request: public organizations change, and the build has no database.
export const dynamic = "force-dynamic";

const SITE_ORIGIN = "https://networkbase.in";

const PUBLIC_LEGAL_PATHS = [
  "/privacy",
  "/terms",
  "/eula",
  "/acceptable-use",
  "/cookies",
  "/subprocessors",
  "/copyright",
  "/grievances",
  "/security-reporting",
  "/support",
  "/dpa",
  "/open-source",
] as const;

/** Public organizations people can find (report §31.2 G15): not hidden, suspended or being deleted, and qualified (decision 69). */
async function publicOrgs(): Promise<MetadataRoute.Sitemap> {
  try {
    const rows = await db.select({ slug: workspaces.slug, updatedAt: workspaces.updatedAt }).from(workspaces)
      .where(and(eq(workspaces.kind, "organization"), eq(workspaces.visibility, "public"), eq(workspaces.status, "active"), isNotNull(workspaces.slug),
        isNull(workspaces.deletedAt), isNull(workspaces.discoverHiddenAt), isNull(workspaces.suspendedAt), isNull(workspaces.deletionScheduledAt), orgIndexableSql()))
      .limit(MAX_URLS);
    return rows.map((row) => ({ url: `${SITE_ORIGIN}/org/${encodeURIComponent(row.slug!)}`, lastModified: row.updatedAt ?? undefined, changeFrequency: "weekly", priority: 0.5 }));
  } catch (error) {
    logger.warn("sitemap.orgs.unavailable", { error: String(error) });
    return [];
  }
}

// ponytail: one sitemap, 50,000 URLs; split with generateSitemaps (Next 16: id is a Promise<string>) + list each file in robots.ts when public pages pass that.
const MAX_URLS = 50_000;

/** Public workspaces search may show: the same rule as SharePreview.indexable in src/lib/sharing/read.ts. */
async function publicWorkspaces(): Promise<MetadataRoute.Sitemap> {
  try {
    const rows = await db.select({ slug: workspaces.slug, updatedAt: workspaces.updatedAt }).from(workspaces)
      .where(and(eq(workspaces.kind, "workspace"), eq(workspaces.visibility, "public"), inArray(workspaces.status, ["active", "completed", "archived"]),
        isNotNull(workspaces.slug), isNull(workspaces.deletedAt), discoverListedSql()))
      .orderBy(desc(workspaces.updatedAt)).limit(MAX_URLS);
    return rows.map((row) => ({ url: `${SITE_ORIGIN}/workspaces/${encodeURIComponent(row.slug!)}`, lastModified: row.updatedAt ?? undefined, changeFrequency: "weekly", priority: 0.6 }));
  } catch (error) {
    logger.warn("sitemap.workspaces.unavailable", { error: String(error) });
    return [];
  }
}

/** Public profiles anyone signed out can open. */
async function publicProfiles(): Promise<MetadataRoute.Sitemap> {
  try {
    const rows = await db.select({ username: profiles.username, updatedAt: profiles.updatedAt }).from(profiles)
      .where(and(eq(profiles.visibility, "public"), isNotNull(profiles.username), readableProfileIdentitySql(null)))
      .orderBy(desc(profiles.updatedAt)).limit(MAX_URLS);
    return rows.map((row) => ({ url: `${SITE_ORIGIN}/u/${encodeURIComponent(row.username!)}`, lastModified: row.updatedAt ?? undefined, changeFrequency: "weekly", priority: 0.5 }));
  } catch (error) {
    logger.warn("sitemap.profiles.unavailable", { error: String(error) });
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date(`${LEGAL_VERSIONS.privacy}T00:00:00.000Z`);

  const legal: MetadataRoute.Sitemap = PUBLIC_LEGAL_PATHS.map((path) => ({
    url: `${SITE_ORIGIN}${path}`,
    lastModified,
    changeFrequency: "yearly",
    priority: path === "/privacy" || path === "/terms" ? 0.6 : 0.4,
  }));
  const [orgs, spaces, people] = await Promise.all([publicOrgs(), publicWorkspaces(), publicProfiles()]);
  return [{ url: `${SITE_ORIGIN}/`, changeFrequency: "weekly", priority: 1 } as const, ...legal, ...orgs, ...spaces, ...people].slice(0, MAX_URLS);
}
