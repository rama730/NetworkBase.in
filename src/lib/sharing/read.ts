import 'server-only';

import { createHash } from 'node:crypto';
import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { profiles, profileSkills, skills, projects, projectSkills, projectOpenRoles, storageAssets } from '@/lib/db/schema';
import { resolvePublicUsernameRoute } from '@/lib/usernames/service';
import { resolvePrivacyRelationship, readableProfileIdentitySql } from '@/lib/privacy/resolver';
import { getProjectAccessByIdentifier, getProjectAccessByIds, canReadProjectTab } from '@/lib/data/workspace-access';
import { normalizeSafeExternalUrl } from '@/lib/messaging/safe-links';
import { logger } from '@/lib/logger';
import { formatProjectTeamRole } from '@/lib/workspaces/settings-policies';
import { genericSharePreview, parseShareResource, portfolioSummary, previewAlt, shareImageUrl, shareSkillSummary, shareText, shareMetric, type ProjectShareDetails, type SharePreview, type ShareResource } from './presentation';

/** A public contribution is the publication authority; memberships/follows are not publication. */
async function readPublicPortfolio(profileId: string) {
  const [row] = await db.execute<{ count: number; title: string | null; external: boolean }>(sql`
    WITH eligible AS (
      SELECT DISTINCT p.id, p.title
      FROM profile_project_contributions c
      JOIN projects p ON p.id = c.project_id
      WHERE c.profile_id = ${profileId}::uuid AND c.deleted_at IS NULL AND c.visibility = 'public'
        AND c.role_kind <> 'viewer' AND p.deleted_at IS NULL AND p.visibility = 'public'
        AND p.status IN ('active', 'completed', 'archived')
    )
    SELECT count(*)::int AS count, CASE WHEN count(*) = 1 THEN min(title) ELSE NULL END AS title,
      EXISTS (SELECT 1 FROM profile_project_contributions c WHERE c.profile_id = ${profileId}::uuid
        AND c.project_id IS NULL AND c.visibility = 'public' AND c.deleted_at IS NULL AND c.role_kind <> 'viewer') AS external
    FROM eligible
  `);
  return row?.external ? portfolioSummary(null, null, true) : portfolioSummary(Number(row?.count ?? 0), row?.title ?? null);
}

async function readPublicSkills(profileId: string) {
  // Canonical public edges only; the legacy JSON can contain private or hidden skills.
  const rows = await db.select({ name: skills.name, total: sql<number>`count(*) OVER()::int` })
    .from(profileSkills).innerJoin(skills, eq(profileSkills.skillId, skills.id))
    .where(and(eq(profileSkills.profileId, profileId), eq(profileSkills.visibility, 'public'), notInArray(skills.status, ['hidden', 'merged'])))
    .orderBy(asc(profileSkills.displayOrder), asc(skills.name)).limit(4);
  return shareSkillSummary(rows.map(row => row.name), rows[0]?.total ?? 0);
}

async function readProfile(resource: ShareResource, viewerId: string | null): Promise<SharePreview> {
  const route = await resolvePublicUsernameRoute({ username: resource.identifier });
  if (route.status === 'not_found') return genericSharePreview(resource, 'unavailable');
  const resolved = { ...resource, identifier: route.currentUsername, url: new URL(`/u/${route.currentUsername}`, resource.url).href };
  const projection = { id: profiles.id, username: profiles.username, fullName: profiles.fullName,
    headline: profiles.headline, avatarUrl: profiles.avatarUrl, avatarAssetId: profiles.avatarAssetId, avatarHash: storageAssets.contentHash, avatarKey: storageAssets.storageKey, visibility: profiles.visibility,
    messagePrivacy: profiles.messagePrivacy, connectionPrivacy: profiles.connectionPrivacy, openToCollaborate: profiles.openToCollaborate };
  let [profile] = await db.select(projection)
    .from(profiles).leftJoin(storageAssets,and(eq(storageAssets.id,profiles.avatarAssetId),eq(storageAssets.ownerUserId,profiles.id),eq(storageAssets.state,'verified'))).where(and(eq(profiles.id, route.userId), isNull(profiles.deletedAt))).limit(1);
  if (!profile || profile.username !== route.currentUsername) return genericSharePreview(resolved, 'unavailable');
  let visibility = profile.visibility ?? 'private';
  const permitted = viewerId ? (await resolvePrivacyRelationship(viewerId, profile.id, { target: { ...profile, visibility } }))?.canViewProfile : visibility === 'public';
  if (!permitted) return { ...genericSharePreview(resolved, 'restricted'), visibility };
  // The summary stays public even in an authorized private in-app card.
  const [skillSummary, portfolio] = await Promise.all([
    readPublicSkills(profile.id).catch(error => { logger.warn('share.skills.unavailable', { error: String(error) }); return { skills: [], skillOverflow: 0 }; }),
    readPublicPortfolio(profile.id).catch(error => { logger.warn('share.portfolio.unavailable', { error: String(error) }); return null; }),
  ]);
  // Summary work is asynchronous: use live identity and permissions again before returning it.
  [profile] = await db.select(projection).from(profiles).leftJoin(storageAssets,and(eq(storageAssets.id,profiles.avatarAssetId),eq(storageAssets.ownerUserId,profiles.id),eq(storageAssets.state,'verified')))
    .where(and(eq(profiles.id, route.userId), isNull(profiles.deletedAt))).limit(1);
  if (!profile) return genericSharePreview(resolved, 'unavailable');
  if (profile.username !== route.currentUsername) return genericSharePreview(resolved, 'unknown');
  visibility = profile.visibility ?? 'private';
  const stillPermitted = viewerId ? (await resolvePrivacyRelationship(viewerId, profile.id, { target: { ...profile, visibility } }))?.canViewProfile : visibility === 'public';
  if (!stillPermitted) return { ...genericSharePreview(resolved, 'restricted'), visibility };
  const name = shareText(profile.fullName).slice(0,160) || `@${profile.username}`;
  const headline = shareText(profile.headline).slice(0,300) || null;
  const result: SharePreview = { ...genericSharePreview(resolved, 'ready'), visibility, indexable: visibility === 'public',
    entityKey: createHash('sha256').update(`profile:${profile.id}`).digest('hex'),
    title: `${name}${name === `@${profile.username}` ? '' : ` (@${profile.username})`} · NetworkBase`,
    description: headline || 'View this profile on NetworkBase.',
    identity: { name, username: profile.username, avatarUrl: normalizeSafeExternalUrl(profile.avatarUrl ?? ''), avatarRevision:createHash('sha256').update(JSON.stringify([profile.avatarAssetId,profile.avatarHash,profile.avatarKey,profile.avatarUrl])).digest('hex').slice(0,16), headline },
    ...skillSummary, portfolio, openToCollaborate: profile.openToCollaborate === true };
  result.imageAlt = previewAlt(result);
  const revision = createHash('sha256').update(JSON.stringify([result.identity, portfolio, skillSummary, result.openToCollaborate])).digest('hex').slice(0, 16);
  result.image = new URL(`/api/og/profile/${route.currentUsername}?v=${revision}`, resource.url).href;
  return result;
}

async function readProjectTeam(projectId: string, ownerId: string, viewerId: string | null, privateAttribution: boolean, publicProject: boolean) {
  const rows = await db.execute<{ id: string; name: string | null; username: string | null; avatar: string | null; asset: string | null; avatarHash: string | null; avatarKey: string | null; role: string; roleTitle: string | null; leadFocus: string | null; guidanceLabel: string | null; total: number }>(sql`
    WITH roster AS (
      SELECT ${ownerId}::uuid AS id, 'owner' AS role, 0 AS priority, NULL::timestamptz AS joined
      UNION ALL
      SELECT user_id, role, 1, joined_at
      FROM project_members WHERE project_id = ${projectId}::uuid AND user_id <> ${ownerId}::uuid
    )
    SELECT profiles.id, profiles.full_name AS name, profiles.username, profiles.avatar_url AS avatar, profiles.avatar_asset_id AS asset, asset.content_hash AS "avatarHash", asset.storage_key AS "avatarKey", roster.role, accepted.title AS "roleTitle", CASE WHEN jsonb_typeof(project.import_source->'metadata'->'leadFocus') = 'string' THEN project.import_source->'metadata'->>'leadFocus' END AS "leadFocus", guidance.label AS "guidanceLabel", count(*) OVER()::int AS total
    FROM roster JOIN profiles ON profiles.id = roster.id
    JOIN projects project ON project.id = ${projectId}::uuid
    LEFT JOIN LATERAL (
      SELECT coalesce(nullif(trim(open_role.title), ''), nullif(trim(open_role.role), '')) AS title
      FROM role_applications application LEFT JOIN project_open_roles open_role ON open_role.id = application.role_id
      WHERE application.project_id = project.id AND application.applicant_id = profiles.id AND application.status = 'accepted'
        AND coalesce(nullif(trim(open_role.title), ''), nullif(trim(open_role.role), '')) IS NOT NULL
      ORDER BY application.updated_at DESC, application.id DESC LIMIT 1
    ) accepted ON true
    LEFT JOIN project_guidance_appointments guidance ON guidance.project_id = project.id AND guidance.guide_user_id = profiles.id
      AND guidance.status = 'active' AND (${privateAttribution} OR (${publicProject} AND guidance.public_attribution_consent))
    LEFT JOIN storage_assets asset ON asset.id = profiles.avatar_asset_id AND asset.owner_user_id = profiles.id AND asset.state = 'verified'
    WHERE ${readableProfileIdentitySql(viewerId)}
    ORDER BY roster.priority, (guidance.id IS NOT NULL) DESC, roster.joined ASC NULLS FIRST, profiles.id LIMIT 5
  `);
  return { team: Array.from(rows, row => ({ id: row.id, name: shareText(row.name).slice(0,160) || (row.username ? '@'+row.username : 'Member'),
    username: row.username, avatarUrl: normalizeSafeExternalUrl(row.avatar ?? ''), avatarRevision:createHash('sha256').update(JSON.stringify([row.asset,row.avatarHash,row.avatarKey,row.avatar])).digest('hex').slice(0,16), role: row.guidanceLabel !== null ? `${shareText(row.guidanceLabel) || 'Mentor'} · Admin` : formatProjectTeamRole({membershipRole:row.role, projectRoleTitle:shareText(row.roleTitle), leadFocus:row.id === ownerId ? shareText(row.leadFocus) : null}) })),
    teamOverflow: Math.max(0, Number(rows[0]?.total ?? 0) - rows.length) };
}

async function readProjectSkills(projectId: string) {
  const rows = await db.select({ name: skills.name, total: sql<number>`count(*) OVER()::int` }).from(projectSkills)
    .innerJoin(skills, eq(projectSkills.skillId, skills.id))
    .where(and(eq(projectSkills.projectId, projectId), notInArray(skills.status, ['hidden', 'merged'])))
    .orderBy(asc(projectSkills.displayOrder), asc(skills.name), asc(skills.id)).limit(4);
  return shareSkillSummary(rows.map(row=>row.name), rows[0]?.total ?? 0);
}

async function readProjectRoles(projectId: string) {
  const rows = await db.select({ id: projectOpenRoles.id, role: projectOpenRoles.role, title: projectOpenRoles.title,
    commitment: projectOpenRoles.commitmentType, total: sql<number>`count(*) OVER()::int` }).from(projectOpenRoles)
    .where(and(eq(projectOpenRoles.projectId, projectId), sql`${projectOpenRoles.count} > ${projectOpenRoles.filled}`,
      sql`${projectOpenRoles.filled} >= 0`, sql`length(trim(coalesce(nullif(trim(${projectOpenRoles.title}), ''), ${projectOpenRoles.role}))) > 0`))
    .orderBy(asc(projectOpenRoles.createdAt), asc(projectOpenRoles.id)).limit(3);
  const titles = rows.map(row=>shareText(row.title)||shareText(row.role));
  return { roles: rows.map((row,index) => ({ id: row.id, title: titles[index]! + (row.commitment && titles.filter(t=>t===titles[index]).length>1 ? ' · '+shareText(row.commitment).replace(/_/g,' ') : '') })),
    roleOverflow: Math.max(0, Number(rows[0]?.total ?? 0) - rows.length) };
}

async function readProject(resource: ShareResource, viewerId: string | null): Promise<SharePreview> {
  const access = await getProjectAccessByIdentifier(resource.identifier, viewerId);
  if (!access.project) return genericSharePreview(resource, 'unavailable');
  const visibility = access.project.visibility === 'public' ? 'public' : access.project.visibility === 'unlisted' ? 'unlisted' : 'private';
  if (!access.canRead) return { ...genericSharePreview(resource, 'restricted'), visibility };
  // An organization's canonical address is /org/<handle> (report §24).
  const resolved = { ...resource, url: new URL(`/${access.project.kind === 'organization' ? 'org' : 'workspaces'}/${access.project.slug || access.project.id}`, resource.url).href };
  const dashboard = canReadProjectTab(access, 'dashboard');
  const [project] = await db.select({ title: projects.title, description: projects.description, shortDescription: projects.shortDescription,
    coverImage: projects.coverImage, coverAsset: projects.coverImageAssetId, coverHash: storageAssets.contentHash, coverKey: storageAssets.storageKey, views: projects.viewCount, followers: projects.followersCount, discoverHiddenAt: projects.discoverHiddenAt })
    .from(projects).leftJoin(storageAssets,and(eq(storageAssets.id,projects.coverImageAssetId),eq(storageAssets.projectId,projects.id),eq(storageAssets.state,'verified'))).where(and(eq(projects.id, access.project.id), isNull(projects.deletedAt))).limit(1);
  if (!project) return genericSharePreview(resource, 'unavailable');
  const unknown = (part: string, error: unknown) => { logger.warn('share.project.'+part+'.unavailable', { error: String(error) }); return null; };
  const [skillSummary, roleSummary] = await Promise.all([
    dashboard ? readProjectSkills(access.project.id).catch(error=>unknown('skills',error)) : null,
    dashboard && access.project.status === 'active' ? readProjectRoles(access.project.id).catch(error=>unknown('roles',error)) : null,
  ]);
  // Last identity read uses live profile visibility/block/connection rules, then project access is rechecked.
  const teamSummary = dashboard ? await readProjectTeam(access.project.id, access.project.ownerId, viewerId, access.isOwner || access.isMember, visibility === 'public').catch(error=>unknown('team',error)) : null;
  const latest = (await getProjectAccessByIds([access.project.id], viewerId))[access.project.id];
  if (!latest?.project) return genericSharePreview(resource, 'unavailable');
  if (!latest.canRead) return { ...genericSharePreview(resource, 'restricted'), visibility };
  if (latest.project.slug !== access.project.slug || latest.project.visibility !== access.project.visibility || latest.project.status !== access.project.status
    || latest.project.ownerId !== access.project.ownerId || latest.isMember !== access.isMember || JSON.stringify(latest.project.publicTabVisibility) !== JSON.stringify(access.project.publicTabVisibility)) return genericSharePreview(resource, 'unknown');
  const details: ProjectShareDetails = { team: teamSummary?.team ?? null, teamOverflow: teamSummary?.teamOverflow ?? null,
    roles: roleSummary?.roles ?? null, roleOverflow: roleSummary?.roleOverflow ?? null,
    views: shareMetric(project.views), followers: shareMetric(project.followers) };
  const result: SharePreview = { ...genericSharePreview(resolved, 'ready'), visibility, indexable: visibility === 'public' && ['active','completed','archived'].includes(access.project.status ?? '')
      && !project.discoverHiddenAt && access.writeBlocked !== 'suspended' && access.writeBlocked !== 'deleting', draft: access.project.status === 'draft',
    entityKey: createHash('sha256').update(`project:${access.project.id}`).digest('hex'),
    title: shareText(project.title).slice(0,160) || 'Workspace on NetworkBase',
    description: shareText(project.shortDescription || (dashboard ? project.description : null)).slice(0,300) || 'View this workspace on NetworkBase.',
    identity: { name: shareText(project.title).slice(0,160) || 'Workspace', username: null, headline: null, avatarUrl: shareImageUrl(project.coverImage, resolved.url), avatarRevision:createHash('sha256').update(JSON.stringify([project.coverAsset,project.coverHash,project.coverKey,project.coverImage])).digest('hex').slice(0,16) },
    ...(skillSummary ?? {}), project: details };
  result.imageAlt = previewAlt(result);
  const revision = createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0,16);
  result.image = new URL(`/api/og/workspace/${access.project.slug || access.project.id}?v=${revision}`, resource.url).href;
  return result;
}

/** Never caches authorization, reads a full profile/history, or records profile views. */
export async function readSharePreview(url: string, viewerId: string | null = null, origin?: string): Promise<SharePreview | null> {
  const resource = parseShareResource(url, origin);
  if (!resource) return null;
  try {
    if (resource.kind === 'application') return genericSharePreview(resource, 'ready');
    return await (resource.kind === 'profile' ? readProfile(resource, viewerId) : readProject(resource, viewerId));
  } catch (error) {
    logger.warn('share.preview.unavailable', { kind: resource.kind, error: error instanceof Error ? error.message : String(error) });
    return genericSharePreview(resource, 'unknown');
  }
}
