import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { workspaces } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { readSharePreview } from '@/lib/sharing/read';
import { genericSharePreview, shareOrigin, shareText, type SharePreview } from '@/lib/sharing/presentation';
import { normalizeSafeExternalUrl } from '@/lib/messaging/safe-links';
import { canReadWorkspaceTab, getWorkspaceAccessByIdentifier } from '@/lib/data/workspace-access';
import { readWorkspaceDocAction } from '@/app/actions/workspace/doc';
import { readWorkspaceUpdatesAction } from '@/app/actions/workspace/updates';
import { getProfileDetails } from '@/lib/data/profile';
import { readmeToPublicMarkdown, type PublicProfileSnapshot, type PublicUpdate, type PublicWorkspaceSnapshot } from './text';

// Not a 'use server' file: nothing here becomes a callable action. Every read is gated on the anonymous
// preview and the anonymous tab rules first, so a bot or the .md copy never sees more than a signed-out person.

function part<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  return read().catch((error) => {
    logger.warn(`public.snapshot.${name}.unavailable`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  });
}

export async function readPublicWorkspaceSnapshot(base: '/workspaces' | '/org', slug: string): Promise<PublicWorkspaceSnapshot | { preview: SharePreview }> {
  const url = new URL(`${base}/${encodeURIComponent(slug)}`, shareOrigin()).href;
  const preview = await readSharePreview(url);
  if (!preview) return { preview: genericSharePreview({ kind: 'project', identifier: slug, url }, 'unavailable') };
  if (preview.state !== 'ready' || preview.kind !== 'project') return { preview };

  const access = await getWorkspaceAccessByIdentifier(slug, null);
  if (!access.project) return { preview: { ...preview, state: 'unavailable' } };
  const projectId = access.project.id;

  const [readme, updates, row] = await Promise.all([
    canReadWorkspaceTab(access, 'readme') ? part('readme', async () => {
      const result = await readWorkspaceDocAction(projectId);
      return result.success && result.data.version
        ? { markdown: readmeToPublicMarkdown(result.data.version.content), updatedAt: result.data.version.createdAt ? String(result.data.version.createdAt) : null }
        : null;
    }) : null,
    canReadWorkspaceTab(access, 'updates') ? part('updates', async () => {
      const result = await readWorkspaceUpdatesAction(projectId);
      if (!result.success) return [];
      return result.data.updates.filter((u) => u.visibility === 'public' && u.content).slice(0, 5).map((u): PublicUpdate => ({
        id: u.id, type: u.updateType ?? null, text: shareText(u.content).slice(0, 2000),
        author: u.author?.fullName ?? (u.author?.username ? `@${u.author.username}` : null), createdAt: String(u.createdAt ?? ''),
      }));
    }) : null,
    part('updated_at', () => db.select({ updatedAt: workspaces.updatedAt }).from(workspaces).where(eq(workspaces.id, projectId)).then((r) => r[0] ?? null)),
  ]);

  return {
    preview,
    kind: access.project.kind === 'organization' ? 'organization' : 'project',
    readme: readme ?? null,
    updates: updates ?? [],
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? shareText(value).slice(0, 2000) : null);

export async function readPublicProfileSnapshot(username: string): Promise<PublicProfileSnapshot | { preview: SharePreview }> {
  const url = new URL(`/u/${encodeURIComponent(username)}`, shareOrigin()).href;
  const preview = await readSharePreview(url);
  if (!preview) return { preview: genericSharePreview({ kind: 'profile', identifier: username, url }, 'unavailable') };
  if (preview.state !== 'ready' || preview.kind !== 'profile') return { preview };

  const details = await part('profile', () => getProfileDetails(username, { viewerUser: null, recordViewEvent: false }));
  if (!details?.profile || details.privacyStatus !== 'public') return { preview: { ...preview, state: 'restricted' } };
  const profile = details.profile as Record<string, unknown>;
  const origin = new URL(preview.url).origin;
  const workspaces = details.collaborationSummary.contributions
    .filter((c) => c.projectHref && c.visibility !== 'private' && c.projectVisibility === 'public'
      && ['active', 'completed', 'archived'].includes(c.projectStatus ?? '') && c.roleKind !== 'viewer')
    .slice(0, 20)
    .map((c) => ({ title: shareText(c.projectTitle).slice(0, 160), url: new URL(c.projectHref!, origin).href, role: text(c.title) }));

  return {
    preview,
    bio: text(profile.bio),
    location: text(profile.location),
    website: typeof profile.website === 'string' ? normalizeSafeExternalUrl(profile.website) : null,
    workspaces,
  };
}
