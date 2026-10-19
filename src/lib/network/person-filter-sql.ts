import "server-only";
import { sql } from "drizzle-orm";
import { readableProfileIdentitySql } from "@/lib/privacy/resolver";
import { containsLikePattern } from "@/lib/search/query";
import { canonicalizeSkillLabels } from "@/lib/skills/matching";
import { findCatalogSkill } from "@/lib/skills/catalog";
import type { NetworkPersonFilters } from "./browse-query";

/** Any assignment makes canonical visibility authoritative, including an all-private skill list. */
export function publicPersonSkillsSql() {
  return sql`CASE WHEN EXISTS (SELECT 1 FROM profile_skills assigned WHERE assigned.profile_id = profiles.id)
        THEN COALESCE((SELECT jsonb_agg(s.name ORDER BY ps.display_order, s.name) FROM profile_skills ps
            JOIN skills s ON s.id=ps.skill_id WHERE ps.profile_id=profiles.id AND ps.visibility='public'
            AND s.status NOT IN ('hidden','merged')), '[]'::jsonb)
        ELSE CASE WHEN jsonb_typeof(profiles.skills)='array' THEN profiles.skills ELSE '[]'::jsonb END END`;
}
export function visibleMutualCountSql(viewerId: string) {
  return sql<number>`(SELECT count(DISTINCT peer.id)::int FROM connections mine JOIN profiles peer
        ON peer.id=CASE WHEN mine.requester_id=${viewerId}::uuid THEN mine.addressee_id ELSE mine.requester_id END
        WHERE mine.status='accepted' AND (mine.requester_id=${viewerId}::uuid OR mine.addressee_id=${viewerId}::uuid)
        AND peer.id<>profiles.id AND peer.deleted_at IS NULL AND peer.onboarding_status='completed'
        AND coalesce(peer.visibility,'public') IN ('public','connections')
        AND NOT EXISTS (SELECT 1 FROM connections blocked WHERE blocked.status='blocked'
            AND ((blocked.requester_id=${viewerId}::uuid AND blocked.addressee_id=peer.id) OR (blocked.addressee_id=${viewerId}::uuid AND blocked.requester_id=peer.id)))
        AND EXISTS (SELECT 1 FROM connections theirs WHERE theirs.status='accepted'
            AND ((theirs.requester_id=profiles.id AND theirs.addressee_id=peer.id) OR (theirs.addressee_id=profiles.id AND theirs.requester_id=peer.id))))`;
}
export function personFilterSql(
  viewerId: string,
  filters?: NetworkPersonFilters,
) {
  const clauses = [];
  if (
    filters?.skills?.length ||
    filters?.location ||
    filters?.hasMutuals ||
    filters?.openToCollaborate
  )
    clauses.push(readableProfileIdentitySql(viewerId));
  for (const skill of canonicalizeSkillLabels(filters?.skills ?? [], 5)) {
    const catalog = findCatalogSkill(skill);
    const names = [
      skill,
      ...(catalog
        ? [catalog.slug, catalog.canonicalKey, ...catalog.aliases]
        : []),
    ].map((name) => name.toLowerCase());
    clauses.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${publicPersonSkillsSql()}) label(value) WHERE lower(trim(label.value)) IN (SELECT jsonb_array_elements_text(${JSON.stringify(names)}::jsonb)))`,
    );
  }
  if (filters?.location)
    clauses.push(
      sql`profiles.location ILIKE ${containsLikePattern(filters.location)}`,
    );
  if (filters?.openToCollaborate)
    clauses.push(sql`profiles.open_to_collaborate=true`);
  if (filters?.hasMutuals)
    clauses.push(sql`${visibleMutualCountSql(viewerId)} > 0`);
  return clauses;
}
