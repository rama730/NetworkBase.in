'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createWorkspaceInvitationAction, searchWorkspaceInviteCandidatesAction } from '@/app/actions/workspace/guidance';
import { getWorkspaceInviteOptionsAction } from '@/app/actions/applications';
import { CopyButton } from '@/components/ui/copy-button';
import { PixelTick } from '@/components/ui/PixelTick';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { openTasks, readGetStarted, writeGetStarted, type GetStartedState, type GetStartedTask } from '@/lib/workspaces/get-started';

type Candidate = { id: string; username: string | null; fullName: string | null; avatarUrl: string | null };

function useGetStarted(projectId: string) {
    const [state, setState] = useState<GetStartedState>(() => readGetStarted(projectId));
    useEffect(() => {
        const sync = (event: Event) => { if ((event as CustomEvent).detail === projectId) setState(readGetStarted(projectId)); };
        window.addEventListener('nb-get-started', sync);
        return () => window.removeEventListener('nb-get-started', sync);
    }, [projectId]);
    const update = useCallback((patch: Partial<GetStartedState>) => setState(writeGetStarted(projectId, patch)), [projectId]);
    return [state, update] as const;
}

/** Invite people inline (v6.7): "@handle or name", pick one, and they're invited to the first open role. */
function InviteInline({ projectId, onInvited }: { projectId: string; onInvited: (handle: string) => void }) {
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<Candidate[]>([]);
    const [roleId, setRoleId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        void getWorkspaceInviteOptionsAction(projectId).then((result) => {
            if (result?.success) setRoleId(result.openRoles?.[0]?.id ?? null);
        }).catch(() => undefined);
    }, [projectId]);
    useEffect(() => {
        const q = query.trim().replace(/^@/, '');
        if (q.length < 2) { setItems([]); return; }
        let live = true;
        const timer = setTimeout(() => void searchWorkspaceInviteCandidatesAction({ projectId, query: q }).then((result) => {
            if (live) setItems(result.success ? (result.items as Candidate[]).slice(0, 5) : []);
        }).catch(() => undefined), 200);
        return () => { live = false; clearTimeout(timer); };
    }, [projectId, query]);
    const invite = async (person: Candidate) => {
        if (!roleId) { setError('Add an open role first: invitations join a role.'); return; }
        const result = await createWorkspaceInvitationAction({ projectId, candidateId: person.id, kind: 'ordinary_role', roleId }).catch(() => null);
        if (!result?.success) { setError((result as { error?: string } | null)?.error ?? 'That invitation didn’t go out. Try again.'); return; }
        setQuery('');
        setItems([]);
        onInvited(person.username ? `@${person.username}` : person.fullName ?? 'them');
    };
    return (
        <div className="nb-gs-invite nb-enter-reveal">
            <input className="nb-gs-input" value={query} onChange={(e) => { setQuery(e.target.value); setError(null); }} placeholder="@handle or name" aria-label="@handle or name" autoFocus autoComplete="off" />
            {items.length ? (
                <ul role="listbox" aria-label="People" className="nb-gs-hits">
                    {items.map((person) => (
                        <li key={person.id} role="option" aria-selected="false" tabIndex={0} onClick={() => void invite(person)} onKeyDown={(e) => { if (e.key === 'Enter') void invite(person); }}>
                            <UserAvatar identity={{ id: person.id, fullName: person.fullName, avatarUrl: person.avatarUrl }} size={22} roundedClassName="rounded-sm" />
                            <span className="min-w-0 truncate">{person.fullName ?? person.username}{person.username ? <span className="text-muted-foreground"> · @{person.username}</span> : null}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
            {error ? <p role="alert" className="text-[12.5px] text-[var(--status-danger)]">{error}</p> : null}
        </div>
    );
}

/** Get started (v6.4/v6.7): up to five real next steps for a new workspace, each with its own action. Rows tick as they're
 *  used; Hide hides it here and on the Overview. */
export function GetStarted({ projectId, slug, title, onResumePartial, overview = false }: { projectId: string; slug: string; title: string; onResumePartial?: () => void; /** On the Overview: nothing once done, a quiet Show link once hidden. */ overview?: boolean }) {
    const [state, update] = useGetStarted(projectId);
    const [inviting, setInviting] = useState(false);
    const [invited, setInvited] = useState<string | null>(null);
    const origin = typeof window === 'undefined' ? 'https://networkbase.in' : window.location.origin;
    const base = `/workspaces/${encodeURIComponent(slug)}`;
    const done = (task: GetStartedTask) => { if (!state.done.includes(task)) update({ done: [...state.done, task] }); };

    if (!state.tasks.length) return null;
    if (overview && !openTasks(state).length) return null;
    if (overview && state.hidden) {
        return <button type="button" className="nb-link text-[13px]" onClick={() => update({ hidden: false })}>Show Get started</button>;
    }
    if (state.hidden) {
        return (
            <section data-get-started className="nbs-frame">
                <p className="nbs-glabel pt-[18px]">Get started<span className="r"><button type="button" className="nb-link text-[13px]" onClick={() => update({ hidden: false })}>Show</button></span></p>
                <p className="nbs-ghelp">Hidden here and on the Overview.</p>
            </section>
        );
    }
    const left = openTasks(state);
    const partial = state.partial;
    const rows: Record<GetStartedTask, { title: string; line: string; action: ReactNode }> = {
        partial: {
            title: partial?.importing ? 'Check the import' : `Finish: ${partial?.label ?? 'the last step'}`,
            line: partial?.importing ? `It keeps going${partial.total ? ` · ${partial.at ?? 0} of ${partial.total} files so far` : ''}. Files shows how far it got.` : 'Create stopped here. Everything else is made.',
            action: <Link className="nb-link text-[13px]" href={`${base}?tab=files`} onClick={() => { done('partial'); onResumePartial?.(); }}>{partial?.importing ? 'Open Files' : 'Finish it'}</Link>,
        },
        invite: {
            title: 'Invite people',
            line: invited ? `Invited ${invited}. They get a notification.` : 'Add people by name, or send the link.',
            action: <span className="flex items-center gap-3"><CopyButton text={`${origin}${base}`} label="Copy link" variant="ghost" /><button type="button" className="nb-link text-[13px]" onClick={() => setInviting((v) => !v)}>Add people</button></span>,
        },
        share: {
            title: `Share the ${state.role ?? 'open role'} opening`,
            line: 'People apply from the Apply link.',
            action: <span onClickCapture={() => done('share')}><CopyButton text={`${origin}${base}#open-roles`} label="Copy Apply link" variant="ghost" /></span>,
        },
        doc: { title: 'Finish the starter doc', line: 'Goals, setup and how to help. It’s a draft until you publish it.', action: <Link className="nb-link text-[13px]" href={`${base}?tab=docs`} onClick={() => done('doc')}>Open doc</Link> },
        files: { title: 'Check the imported files', line: 'See what came in, and fix anything that didn’t.', action: <Link className="nb-link text-[13px]" href={`${base}?tab=files`} onClick={() => done('files')}>Open Files</Link> },
        update: { title: 'Post the first update', line: `Tell followers what ${title} is starting with.`, action: <Link className="nb-link text-[13px]" href={`${base}?tab=updates`} onClick={() => done('update')}>Write update</Link> },
    };
    return (
        <section data-get-started aria-labelledby={`get-started-${projectId}`} className="nbs-frame">
            <p id={`get-started-${projectId}`} className="nbs-glabel pt-[18px]">
                Get started
                <span className="r">
                    <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{state.tasks.length - left.length} of {state.tasks.length}</span>
                    <button type="button" className="nb-link text-[13px]" onClick={() => update({ hidden: true })}>Hide</button>
                </span>
            </p>
            {state.tasks.map((task) => {
                const isDone = state.done.includes(task);
                const row = rows[task];
                return (
                    <div key={task} data-task={task} data-done={isDone} className="nb-gs-row">
                        <span className="nb-gs-box" data-done={isDone || undefined} aria-hidden="true">{isDone ? <PixelTick draw /> : task === 'partial' ? '!' : null}</span>
                        <div className="min-w-0">
                            <p className="t">{row.title}</p>
                            <p className="d">{row.line}</p>
                            {task === 'invite' && inviting ? <InviteInline projectId={projectId} onInvited={(who) => { setInvited(who); setInviting(false); done('invite'); }} /> : null}
                        </div>
                        <div className="ctl">{row.action}</div>
                    </div>
                );
            })}
        </section>
    );
}
