import type { MetadataRoute } from "next";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import { logger } from "@/lib/logger";

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

/** Public organizations people can find (report §31.2 G15): not hidden, suspended or being deleted. */
async function publicOrgs(): Promise<MetadataRoute.Sitemap> {
  try {
    // ponytail: one sitemap capped at 5,000 orgs; split with generateSitemaps when public orgs pass that.
    const rows = await db.select({ slug: projects.slug, updatedAt: projects.updatedAt }).from(projects)
      .where(and(eq(projects.kind, "organization"), eq(projects.visibility, "public"), eq(projects.status, "active"), isNotNull(projects.slug),
        isNull(projects.deletedAt), isNull(projects.discoverHiddenAt), isNull(projects.suspendedAt), isNull(projects.deletionScheduledAt)))
      .limit(5_000);
    return rows.map((row) => ({ url: `${SITE_ORIGIN}/org/${encodeURIComponent(row.slug!)}`, lastModified: row.updatedAt ?? undefined, changeFrequency: "weekly", priority: 0.5 }));
  } catch (error) {
    logger.warn("sitemap.orgs.unavailable", { error: String(error) });
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
  return [...legal, ...(await publicOrgs())];
}
