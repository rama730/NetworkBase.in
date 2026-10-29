import { normalizeSafeExternalUrl } from "@/lib/messaging/safe-links";
import { genericSharePreview, parseShareResource, shareImageUrl, shareText, shareMetric, projectPreviewDestination, type WorkspaceShareDetails, type SharePreview } from '@/lib/sharing/presentation';


import { normalizeDisplayAuthorization, type PreviewDisplayAuthorization } from './display-authorization';

export type LinkPreviewData = {
  title: string | null; description: string | null; image: string | null; domain: string; url: string;
  titleSource?: "provider" | "open_graph" | "html_title" | "url" | null;
  health?: "unknown" | "active" | "unavailable"; checkedAt?: string; resolvedHost?: string; contentType?: string | null;
  firstParty?: SharePreview;
  openUrl?: string;
  displayAuthorization?: PreviewDisplayAuthorization | null;
};

function normalizeProjectDetails(value: unknown): WorkspaceShareDetails | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as WorkspaceShareDetails;
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id);
  const team = Array.isArray(data.team) && data.team.length <= 5 && data.team.every(p=>p && validId(p.id) && shareText(p.name))
    && new Set(data.team.map(p=>p.id)).size === data.team.length ? data.team.map(p=>({id:p.id,name:shareText(p.name).slice(0,160),
      username:typeof p.username === 'string' ? p.username.slice(0,20) : null,avatarUrl:typeof p.avatarUrl === 'string' ? normalizeSafeExternalUrl(p.avatarUrl) : null,avatarRevision:typeof p.avatarRevision==='string'&&/^[a-f\d]{16}$/.test(p.avatarRevision)?p.avatarRevision:undefined,role:shareText(p.role).slice(0,80)})) : null;
  const roles = Array.isArray(data.roles) && data.roles.length <= 3 && data.roles.every(r=>r && validId(r.id) && shareText(r.title))
    && new Set(data.roles.map(r=>r.id)).size === data.roles.length ? data.roles.map(r=>({id:r.id,title:shareText(r.title).slice(0,160)})) : null;
  return {team,teamOverflow:team ? shareMetric(data.teamOverflow) : null, roles, roleOverflow:roles ? shareMetric(data.roleOverflow) : null,
    views:shareMetric(data.views), followers:shareMetric(data.followers)};
}

/** Configured local first-party routes use domain reads, never an outbound loopback fetch. */
export function normalizePreviewRequestUrl(value: string, origin?: string): string | null {
  const resource = parseShareResource(value, origin);
  return resource ? new URL(value, resource.url).href : normalizeSafeExternalUrl(value);
}

/** Cache/API data is untrusted too: never return an unsafe href or image. */
export function normalizeLinkPreview(value: unknown, requestedUrl: string, origin?: string): LinkPreviewData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const url = normalizePreviewRequestUrl(requestedUrl,origin);
  if (!url || typeof data.url !== "string" || normalizePreviewRequestUrl(data.url,origin) !== url) return null;
  const host = typeof data.resolvedHost === "string" && normalizeSafeExternalUrl(`https://${data.resolvedHost}/`)
    ? new URL(`https://${data.resolvedHost}/`).hostname : new URL(url).hostname;
  let firstParty: SharePreview | undefined;
  const resource = parseShareResource(url,origin);
  if (resource && data.firstParty && typeof data.firstParty === 'object') {
    const value = data.firstParty as SharePreview;
    const destination = typeof value.url === 'string' ? parseShareResource(value.url,origin) : null;
    if (destination?.kind === resource.kind && value.kind === resource.kind && ['ready', 'restricted', 'unavailable', 'unknown'].includes(value.state)) {
      const identity = value.state === 'ready' && value.identity && typeof value.identity === 'object' ? {
        name: shareText(value.identity.name).slice(0, 160), username: typeof value.identity.username === 'string' ? value.identity.username.slice(0,20) : null,
        avatarUrl: shareImageUrl(value.identity.avatarUrl ?? null, destination.url), avatarRevision:typeof value.identity.avatarRevision==='string'&&/^[a-f\d]{16}$/.test(value.identity.avatarRevision)?value.identity.avatarRevision:undefined, headline: shareText(value.identity.headline).slice(0,300) || null,
      } : undefined;
      firstParty = { kind:resource.kind,state:value.state,url:destination.url,title:shareText(value.title).slice(0,160),description:shareText(value.description).slice(0,500),
        image:normalizeSafeExternalUrl(value.image) ?? '',imageAlt:shareText(value.imageAlt).slice(0,4000),indexable:value.indexable === true,
        identity,portfolio:identity ? shareText(value.portfolio) || null : null,
        skills:identity && Array.isArray(value.skills) ? value.skills.filter(label=>typeof label==='string').slice(0,4).map(shareText) : [],
        skillOverflow:identity && Number.isSafeInteger(value.skillOverflow) ? Math.max(0,value.skillOverflow) : 0,
        openToCollaborate:Boolean(identity && value.openToCollaborate === true) };
      if (typeof value.entityKey === 'string' && /^[a-f\d]{64}$/.test(value.entityKey)) firstParty.entityKey = value.entityKey;
      if (['public', 'connections', 'private', 'unlisted'].includes(value.visibility ?? '')) firstParty.visibility = value.visibility;
      if (identity && resource.kind === 'project') { firstParty.project = normalizeProjectDetails(value.project); firstParty.draft = value.draft === true; }
      if (value.state !== 'ready') {
        const neutral = genericSharePreview(resource, value.state);
        // Neutral snapshots cannot retain an earlier name, image alt or private readable slug.
        const safeHint = value.state === 'unknown' && ['Offline. Reconnect to load this preview.', 'Checking preview access. Retry if it cannot be verified.'].includes(value.description);
        firstParty = { ...neutral, ...(firstParty.visibility ? { visibility: firstParty.visibility } : {}),
          ...(safeHint ? { description: value.description } : {}) };
      }
    }
  }
  return {
    url, domain: host,
    title: resource && firstParty?.state !== 'ready' ? firstParty?.title ?? null : typeof data.title === "string" ? data.title.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim().slice(0, 160) || null : null,
    description: resource && firstParty?.state !== 'ready' ? firstParty?.description ?? null : typeof data.description === "string" ? data.description.replace(/\s+/g, " ").trim().slice(0, 500) || null : null,
    image: resource ? null : typeof data.image === "string" ? normalizeSafeExternalUrl(data.image) : null,
    titleSource: ["provider", "open_graph", "html_title", "url"].includes(String(data.titleSource)) ? data.titleSource as LinkPreviewData["titleSource"] : null,
    health: data.health === "active" || data.health === "unavailable" ? data.health : "unknown",
    checkedAt: typeof data.checkedAt === "string" && Number.isFinite(Date.parse(data.checkedAt)) ? data.checkedAt : undefined,
    resolvedHost: host,
    contentType: typeof data.contentType === "string" ? data.contentType.slice(0, 120) : null,
    ...(firstParty?.kind === 'project' ? { openUrl: projectPreviewDestination(url,firstParty.url,origin) } : {}),
    ...(firstParty ? { firstParty, displayAuthorization: firstParty.state === 'ready' ? normalizeDisplayAuthorization(data.displayAuthorization) : null } : {}),
  };
}
