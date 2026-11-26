import { resolveAuthBaseUrl } from '@/lib/auth/redirects';
import { normalizeUsername, validateUsername } from '@/lib/validations/username';
import { normalizeSafeExternalUrl } from '@/lib/messaging/safe-links';

export type ShareKind = 'profile' | 'project' | 'application';
export type ShareResource = { kind: ShareKind; identifier: string; url: string };
export type ShareTeamPerson = { id: string; name: string; username: string | null; avatarUrl: string | null; avatarRevision?: string; role: string };
export type WorkspaceShareDetails = {
  team: ShareTeamPerson[] | null; teamOverflow: number | null;
  roles: { id: string; title: string }[] | null; roleOverflow: number | null;
  views: number | null; followers: number | null;
};
export function shareMetric(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
export function projectImageSkillsFit(preview: SharePreview) { return preview.skills.every(s => s.length <= 120 && /^[\u0020-\u024f\u2000-\u206f]*$/.test(s)); }
export function projectRolesFitImage(preview: SharePreview) {
  return preview.title.length <= 100 && preview.description.length <= 130 && (!projectImageSkillsFit(preview) || preview.skills.every(s => s.length <= 40))
    && Boolean(preview.project?.roles?.every(role => role.title.length <= 42 && /^[\u0020-\u024f\u2000-\u206f]*$/.test(role.title)));
}
export type SharePreview = {
  kind: ShareKind;
  state: 'ready' | 'restricted' | 'unavailable' | 'unknown';
  url: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  indexable: boolean;
  /** Stable opaque identity for compose intent; never a permission token or OG field. */
  entityKey?: string;
  visibility?: 'public' | 'connections' | 'private' | 'unlisted';
  byline?: string | null;
  project?: WorkspaceShareDetails;
  draft?: boolean;
  identity?: { name: string; username: string | null; avatarUrl: string | null; avatarRevision?: string; headline: string | null };
  portfolio: string | null;
  skills: string[];
  skillOverflow: number;
  openToCollaborate: boolean;
};

export function shareOrigin(requestUrl?: string) { return resolveAuthBaseUrl({requestUrl}); }

/** Only reduces crawler work; it never grants access or changes the anonymous projection. */
export function isShareCrawler(userAgent: string | null): boolean {
  const ua = userAgent ?? '';
  // Anything that isn't a browser (no Mozilla/, curl, AI link fetchers) or names itself a bot reads the plain page.
  return !ua.includes('Mozilla/')
    || /facebookexternalhit|facebot|twitterbot|slackbot|discordbot|linkedinbot|whatsapp|telegrambot|pinterestbot|googlebot|bingbot|linkpreviewbot|bot[/;)]|\bbot\b|crawl|spider|slurp|-user\/|searchbot|google-extended|google-inspectiontool|googleother|meta-externalagent/i.test(ua);
}

export function profileSharePath(username: unknown): string | null {
  if (typeof username !== 'string') return null;
  const normalized = normalizeUsername(username);
  return validateUsername(normalized).valid ? `/u/${normalized}` : null;
}

/** Trusted configured origin only. Message text stays intact; this resolves its destination. */
export function parseShareResource(value: string, origin?: string): ShareResource | null {
  try {
    if (!value.trim() || value.length > 2048) return null;
    origin ??= shareOrigin();
    const url = new URL(value, origin);
    const base = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.hostname !== base.hostname || url.port !== base.port) return null;
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (path === '/') return { kind: 'application', identifier: '', url: base.origin + '/' };
    // /projects/<slug> is the old address of /workspaces/<slug>; links already shared still parse.
    const match = path.match(/^\/(u|workspaces|projects|org)\/([^/]+)$/);
    if (!match) return null;
    const identifier = decodeURIComponent(match[2]!);
    if (match[1] === 'u') {
      const path = profileSharePath(identifier);
      return path ? { kind: 'profile', identifier: normalizeUsername(identifier), url: base.origin + path } : null;
    }
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(identifier)) return null;
    return { kind: 'project', identifier, url: `${base.origin}/${match[1] === 'org' ? 'org' : 'workspaces'}/${encodeURIComponent(identifier)}` };
  } catch { return null; }
}

/** Explicit content links keep only recognized route state; sharing a project generally uses its root. */
export function projectPreviewDestination(requested: string, canonical: string, origin?: string): string {
  const source = parseShareResource(requested, origin), target = parseShareResource(canonical, origin);
  if (source?.kind !== 'project' || target?.kind !== 'project') return canonical;
  const input = new URL(requested, source.url), output = new URL(target.url);
  const tab = input.searchParams.get('tab');
  const keys: Record<string,string[]> = {
    dashboard: [], tasks:['taskId','drawerType','drawerId','panelTab','sprint','sprintId'], sprints:['sprint','sprintId','task','taskId'],
    files:['fileId','path','line','column','filesView','filesTask'], updates:['updateId','commentId'], readme:['doc','readmeMode'], settings:['settings','section'],
  };
  if (tab && Object.hasOwn(keys,tab)) {
    output.searchParams.set('tab',tab);
    for (const key of keys[tab]!) {
      const value=input.searchParams.get(key);
      if(!value||value.length>240)continue;
      if(key==='path' ? !/[%:\\\u0000-\u001f\u007f]/.test(value)&&!value.startsWith('//')&&!value.split('/').includes('..') : /^[a-zA-Z0-9_.-]{1,100}$/.test(value)&&!value.includes('..'))output.searchParams.set(key,value);
    }
  }
  if(/^#[a-zA-Z0-9_-]{1,120}$/.test(input.hash))output.hash=input.hash;
  return output.href;
}

export function shareText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim() : '';
}

export function shareImageUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  const safe = normalizeSafeExternalUrl(value);
  if (safe) return safe;
  try {
    const url = new URL(value, base);
    return url.origin === new URL(base).origin && /^\/api\/v1\/(?:workspaces|projects)\/[a-f0-9-]{36}\/image$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

export function shareSkillSummary(labels: readonly string[], total?: number) {
  const unique = [...new Map(labels.map(shareText).filter(Boolean).map(label => [label.toLowerCase(), label])).values()];
  return { skills: unique.slice(0, 4), skillOverflow: Math.max(0, (total ?? unique.length) - Math.min(4, unique.length)) };
}

export function portfolioSummary(count: number | null, title: string | null = null, exists = false): string | null {
  if (count === 0 || (count === null && !exists)) return null;
  if (count === 1) return shareText(title) ? `Public portfolio · ${shareText(title)}` : 'Explore public portfolio';
  return count === null ? 'Explore public portfolio' : `Public portfolio · ${count} contributions`;
}

export function genericSharePreview(resource: ShareResource, state: SharePreview['state'] = 'unknown'): SharePreview {
  const title = resource.kind === 'application' ? 'NetworkBase' : `${resource.kind === 'profile' ? 'Profile' : 'Workspace'} on NetworkBase`;
  return { kind: resource.kind, state, url: resource.url, title,
    description: resource.kind === 'application' ? 'Professional social network for people.'
      : state === 'unavailable' ? `This ${resource.kind} is unavailable.`
      : state === 'unknown' ? 'Preview details could not load. You can still open the link.' : `Open this ${resource.kind} on NetworkBase.`,
    image: new URL('/og/routes-card.png', resource.url).href, imageAlt: 'NetworkBase — professional network for people',
    indexable: resource.kind === 'application', portfolio: null, skills: [], skillOverflow: 0, openToCollaborate: false };
}

export function previewAlt(preview: SharePreview): string {
  return [preview.identity?.name ?? preview.title, preview.identity?.username ? `@${preview.identity.username}` : '', preview.description, preview.byline,
    preview.openToCollaborate ? 'Open to collaboration' : '', preview.portfolio, preview.skills.join(', '),
    preview.skillOverflow ? `${preview.skillOverflow} more skills` : '',
    ...(preview.project?.team ?? []).map(person => person.name + ' · ' + person.role),
    preview.project?.teamOverflow ? `${preview.project.teamOverflow} more team members` : '',
    preview.project?.views != null ? `${preview.project.views.toLocaleString('en-US')} views` : '',
    preview.project?.followers != null ? `${preview.project.followers.toLocaleString('en-US')} followers` : '',
    ...(preview.project?.roles ?? []).map(role => role.title),
    preview.project?.roleOverflow ? `${preview.project.roleOverflow} more open roles` : ''].filter(Boolean).join('. ');
}

export function socialImageCanRender(preview: SharePreview) {
  if(preview.kind==='project') {
    const name=preview.identity?.name??preview.title;
    return [name.length>140?name.slice(0,137)+'…':name,preview.description.length>170?preview.description.slice(0,167)+'…':preview.description]
      .every(value=>/^[\u0020-\u024f\u2000-\u206f]*$/.test(value));
  }
  return preview.skills.every(skill=>skill.length<=120) && [preview.identity?.name,preview.byline,preview.description,preview.portfolio,...preview.skills].filter(Boolean)
    .every(value=>/^[\u0020-\u024f\u2000-\u206f]*$/.test(value!));
}

export function accessCopy(preview: SharePreview): string {
  if (preview.state === 'unavailable') return `This ${preview.kind} is no longer available.`;
  if (preview.state === 'unknown') return 'Preview details could not load. You can still copy a resolved link.';
  if (preview.kind === 'project' && preview.draft) return 'Draft · unpublished. Sharing this link does not publish the workspace or grant access.';
  // Report §37.7: an organization that isn't public shows outsiders its private page.
  if (preview.title === 'Private organization') return 'People without access will see the private page.';
  if (preview.visibility === 'connections') return 'Only permitted connections can view this profile. Sharing does not change access.';
  if (preview.visibility === 'private') return `This ${preview.kind} is private. Sharing does not change access.`;
  if (preview.state === 'restricted') return `Access is required to view this ${preview.kind}. Sharing does not grant access.`;
  if (preview.visibility === 'unlisted') return 'This workspace is unlisted. Anyone with its link can view it, but it is not indexed.';
  return `Anyone with this link can view the ${preview.kind === 'application' ? 'application' : `public ${preview.kind}`}.`;
}
