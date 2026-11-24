'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import ProjectCard from '@/components/workspaces/WorkspaceCard';
import { GetStarted } from '@/components/workspaces/GetStarted';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { PixelTick } from '@/components/ui/PixelTick';
import { useAuth } from '@/hooks/useAuth';
import { readGetStarted, writeGetStarted, type GetStartedTask } from '@/lib/workspaces/get-started';
import type { CreateLocation } from '@/components/organizations/CreateLocation';
import type { CreateWorkspaceInput } from '@/lib/validations/workspace';
import { createSteps } from './create-steps';
import { buildPreviewWorkspace } from './preview-workspace';
import type { CreateFinished } from './useCreateWorkspaceWizard';

/** After Create (v6.4): a short stop before the workspace — what was made, Get started, the live card, then Open. */
export function FinishView({ finished, values, childOrg, projectImage, onOpen, onCreateAnother }: {
    finished: CreateFinished;
    values: CreateWorkspaceInput;
    childOrg?: CreateLocation | null;
    projectImage?: File | null;
    onOpen: () => void;
    onCreateAnother: () => void;
}) {
    const { user } = useAuth();
    const title = values.title?.trim() || 'Your workspace';
    const slug = finished.slug ?? finished.projectId;
    const address = `networkbase.in/w/${slug}`;
    const origin = typeof window === 'undefined' ? 'https://networkbase.in' : window.location.origin;
    const roles = (values.roles ?? []).filter((role) => role.role.trim());
    const openings = roles.reduce((n, role) => n + (role.count ?? 0), 0);
    const firstRole = roles[0]?.role;
    const source = values.import_source?.type ?? 'scratch';
    const steps = createSteps(values, { uploadCount: Number((values.import_source?.metadata as { fileCount?: number } | undefined)?.fileCount ?? 0), peopleCount: 0, orgTitle: null });

    // The first visit writes the list; later visits (and the Overview) read it.
    useEffect(() => {
        if (readGetStarted(finished.projectId).tasks.length) return;
        const tasks: GetStartedTask[] = [
            ...(finished.partial || finished.importing ? ['partial' as const] : []),
            'invite',
            ...(openings ? ['share' as const] : []),
            ...(values.readme?.mode === 'skip' ? [] : ['doc' as const]),
            ...(source !== 'scratch' && !finished.importing ? ['files' as const] : []),
            'update',
        ];
        writeGetStarted(finished.projectId, {
            tasks: tasks.slice(0, 5),
            role: firstRole,
            partial: finished.partial ? { ...finished.partial } : finished.importing ? { key: 'import', label: 'the import', at: finished.importing.at, total: finished.importing.total, importing: true } : undefined,
        });
    }, [finished, openings, firstRole, source, values.readme?.mode]);

    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!projectImage) return;
        const url = URL.createObjectURL(projectImage);
        setCoverUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [projectImage]);
    const card = useMemo(() => buildPreviewWorkspace(values, { noun: 'workspace', coverUrl, user, id: finished.projectId, slug, cardOrg: childOrg ? { id: childOrg.id, title: childOrg.title, slug: childOrg.slug } : undefined }), [values, coverUrl, user, finished.projectId, slug, childOrg]);

    const made = steps.map((step) => {
        const failed = finished.partial?.key === step.key;
        const importing = step.key === 'import' && finished.importing;
        const label = step.key === 'make' ? 'workspace'
            : step.key === 'doc' ? `starter doc ${values.readme?.publishOnCreate ? 'published' : 'drafted'}`
            : step.key.startsWith('workflow:') ? step.label.replace(/^Adding the /, '')
            : step.key === 'openings' ? step.label.replace(/^Posting /, '')
            : step.key === 'people' ? step.label.replace(/^Adding /, '').replace(/ to the teams$/, ' added')
            : step.key === 'upload' ? `${step.count ?? 0} files`
            : 'files';
        return { key: step.key, state: failed ? 'failed' : importing ? 'running' : 'done', text: importing ? `importing · ${finished.importing!.at} of ${finished.importing!.total} files so far` : failed ? `${label} · didn’t finish` : label };
    });
    const visibility = values.visibility === 'private' ? 'Private: only members see it' : values.visibility === 'org' ? `${childOrg?.title ?? 'Organization'} members can see it` : 'Public: anyone can find it';
    const share = `${title}${values.short_description ? `: ${values.short_description.replace(/[.!?]?$/, '.')}` : '.'}${firstRole ? ` Looking for a ${firstRole}.` : ''} ${origin}/workspaces/${slug}`;

    return (
        <section data-finish aria-labelledby="finish-title" className="nb-finish">
            <div className="min-w-0">
                <div className="nb-finish-hero">
                    <span className="nb-creating-mark" aria-hidden="true" style={{ ['--fill' as string]: '100%' }}><span>{(title.match(/\b[\p{L}\p{N}]/gu) ?? ['N']).slice(0, 2).join('').toUpperCase()}</span><PixelTick className="nb-finish-tick" draw /></span>
                    <p className="font-mono text-[12px] text-muted-foreground">{childOrg ? `${childOrg.title} / ` : ''}{address}</p>
                    <h2 id="finish-title" className="nb-creating-title">{title} is open.</h2>
                    <p className="nb-creating-lead">{visibility}{openings ? ` · ${openings} ${openings === 1 ? 'opening takes' : 'openings take'} applications` : ''}.</p>
                </div>

                <ul data-made className="nb-made" aria-label="What was made">
                    {made.map((item, i) => (
                        <li key={item.key} data-state={item.state} className="nb-enter-settle" style={{ ['--i' as string]: i }}>
                            <span className="nb-creating-box" aria-hidden="true">{item.state === 'done' ? <PixelTick draw /> : item.state === 'failed' ? '!' : null}</span>
                            {item.text}
                        </li>
                    ))}
                </ul>

                <GetStarted projectId={finished.projectId} slug={slug} title={title} />

                <div className="nb-finish-actions">
                    <Button type="button" variant="ghost" onClick={onCreateAnother}>Create another</Button>
                    <Button type="button" className="nb-finish-open" onClick={onOpen}>Open {title}</Button>
                </div>
            </div>

            <aside data-finish-side aria-label="Where it shows" className="nb-review-side">
                <section className="nbs-frame" aria-labelledby="finish-discover">
                    <p id="finish-discover" className="nbs-glabel pt-[18px]">On Discover</p>
                    <div className="nb-sbody">
                        <div className="pointer-events-none select-none" inert><ProjectCard project={card} /></div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate font-mono text-[12px]">{address}</span>
                            <CopyButton text={`${origin}/workspaces/${slug}`} label="Copy address" />
                        </div>
                    </div>
                </section>
                {childOrg ? (
                    <section className="nbs-frame" aria-labelledby="finish-org">
                        <p id="finish-org" className="nbs-glabel pt-[18px]">In {childOrg.title}</p>
                        <div className="nb-sbody">
                            <p className="text-[13px] text-muted-foreground">Added to the top of its Workspaces tab.</p>
                            <Link className="nb-link mt-2 inline-block text-[13px]" href={`/org/${encodeURIComponent(childOrg.slug ?? childOrg.id)}?tab=projects&wnew=${encodeURIComponent(finished.projectId)}`}>Back to {childOrg.title}</Link>
                        </div>
                    </section>
                ) : null}
                <section className="nbs-frame" aria-labelledby="finish-share">
                    <p id="finish-share" className="nbs-glabel pt-[18px]">Share it</p>
                    <div className="nb-sbody">
                        <p className="nb-finish-share">{share}</p>
                        <CopyButton text={share} label="Copy text" />
                    </div>
                </section>
            </aside>
        </section>
    );
}
