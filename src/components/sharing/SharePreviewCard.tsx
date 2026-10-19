'use client';

import Link from 'next/link';
import { ProjectShareContents } from './ProjectShareContents';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { BrandMark } from '@/components/brand/BrandMark';
import type { SharePreview } from '@/lib/sharing/presentation';

export function SharePreviewCard({ preview, linked = false, loading = false, trailingAction = false, destination }: { preview: SharePreview; linked?: boolean; loading?: boolean; trailingAction?: boolean; destination?: string }) {
  const identity = preview.state === 'ready' ? preview.identity : undefined;
  const content = preview.kind === 'project' ? <ProjectShareContents preview={preview} loading={loading} trailingAction={trailingAction}/> : <>
    <div className="flex min-w-0 items-start gap-3">
      {identity ? <UserAvatar key={identity.avatarRevision} identity={{ fullName: identity.name === `@${identity.username}` ? null : identity.name, username: identity.username, avatarUrl: identity.avatarUrl }} size={54} unoptimized />
        : <div className="flex size-[54px] shrink-0 items-center justify-center rounded-[3px] border border-border bg-muted"><BrandMark variant="monogram" size={26} /></div>}
      <div className={`min-w-0 flex-1 ${trailingAction ? "pr-10" : ""}`}>
        {loading ? <><div aria-hidden className="nb-skeleton mt-1 h-4 w-4/5" /><div aria-hidden className="nb-skeleton mt-2 h-3 w-3/5" /></> : <>
          <div dir="auto" className="nb-ui-label break-words font-semibold">{identity?.name ?? preview.title}</div>
          {identity && preview.byline ? <p dir="auto" className="nb-compact mt-1 break-words text-muted-foreground">{preview.byline}</p> : null}
          {identity?.headline || !identity ? <p dir="auto" className="nb-compact mt-1 break-words text-muted-foreground">{identity?.headline ?? preview.description}</p> : null}
        </>}
        <div dir="ltr" className="nb-meta mt-2 break-all">{new URL(preview.url).hostname}{identity?.username && identity.name !== `@${identity.username}` ? ` · @${identity.username}` : ''}</div>
      </div>
    </div>
    {identity && (preview.portfolio || preview.skills.length > 0) ? <div className="mt-3 min-w-0 space-y-2">
      {preview.portfolio ? <p dir="auto" className="nb-compact break-words text-muted-foreground">{preview.portfolio.includes(' · ') ? <>{preview.portfolio.split(' · ')[0]} · <strong className="font-medium text-foreground">{preview.portfolio.split(' · ').slice(1).join(' · ')}</strong></> : preview.portfolio}</p> : null}
      {preview.skills.length ? <div className="flex flex-wrap gap-1.5" aria-label="Public skills">
        {preview.skills.map(skill => <span dir="auto" key={skill} className="nb-tag rounded-[3px] max-w-full [overflow-wrap:anywhere]">{skill}</span>)}
        {preview.skillOverflow > 0 ? <span className="nb-tag rounded-[3px]" aria-label={`${preview.skillOverflow} more ${preview.skillOverflow === 1 ? 'skill' : 'skills'}`}>+{preview.skillOverflow}</span> : null}
      </div> : null}
    </div> : null}
  </>;
  const className = 'block min-w-0 rounded-lg border border-border bg-muted p-3.5';
  if (preview.kind === 'project') return <div aria-busy={loading || undefined} className={className+' relative'}>{linked?<Link href={destination ?? preview.url} prefetch={false} aria-label={preview.title+'. Open project'} className="after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-primary"><span className="sr-only">Open project</span></Link>:null}{content}</div>;
  return linked ? <Link href={destination ?? preview.url} prefetch={false} aria-label={preview.imageAlt + '. Open ' + preview.kind} aria-busy={loading || undefined} className={className + ' hover:bg-secondary'}>{content}</Link>
    : <div aria-busy={loading || undefined} className={className}>{content}</div>;
}
