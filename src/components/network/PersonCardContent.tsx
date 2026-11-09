"use client";

import { SharedOrgChip } from '@/components/organizations/SharedOrgChip';
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, MapPin, Users } from 'lucide-react';
import { readPersonSharedConnectionsAction } from '@/app/actions/connections';
import type { SharedConnectionsSummary } from '@/lib/connections/shared';
import { personCardName, personCardSkills, personCardSubtitle, personCompactCount, personConnectedDate, personPortfolioText, personSharedCount, type PersonCardIdentity } from '@/lib/network/person-card';
import { canonicalSkillKey, matchingSkillLabels } from '@/lib/skills/matching';
import { profileHref } from '@/lib/routing/identifiers';
import { CONNECTION_COPY } from '@/lib/connections/copy';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { SkillIcon } from '@/components/skills/SkillIcon';
import { resolveClientSkill, useSkillCatalog } from '@/lib/skills/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PersonPresenceDot } from './PersonPresenceDot';
import { OpenToCollaborateBadge } from '@/components/profile/OpenToCollaborateBadge';

export function PersonCardLayout({ avatar, head, headline, location, meta = [], body, aside, className = '', variant = 'network', restoreId }: {
    avatar: ReactNode; head: ReactNode; headline?: ReactNode; location?: ReactNode;
    meta?: ReactNode[]; body?: ReactNode; aside?: ReactNode; className?: string; variant?: 'network' | 'rail';
    /** Back returns to this card (unified back A4). */
    restoreId?: string;
}) {
    const cardRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const card = cardRef.current;
        if (!card) return;
        const fit = () => {
            const relationship = card.querySelector<HTMLElement>('.nb-person-relationship');
            if (!relationship) return;
            relationship.classList.remove('shared-compact', 'date-short');
            const label = relationship.querySelector<HTMLElement>('.nb-person-shared-full');
            const date = relationship.querySelector<HTMLElement>('.nb-person-date');
            if (label && label.scrollWidth > label.clientWidth + 1) relationship.classList.add('shared-compact');
            if (date && date.scrollWidth > date.clientWidth + 1) relationship.classList.add('date-short');
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(card);
        void document.fonts.ready.then(fit);
        return () => observer.disconnect();
    }, [meta, aside]);
    return <div className="nb-person-card-host" data-variant={variant}>
        <article ref={cardRef} data-slot="person-card" data-restore-id={restoreId} className={`nb-person-card relative ${className}`}>
            <div className="nb-person-identity">
                <div className="nb-person-avatar">{avatar}</div>
                <div className="nb-person-identity-text">{head}{headline ? <div className="nb-person-subtitle">{headline}</div> : null}</div>
            </div>
            {aside ? <div className="nb-person-action">{aside}</div> : null}
            {location ? <div className="nb-person-context">{location}</div> : null}
            {body ? <div className="nb-person-skills-row">{body}</div> : null}
            <div className="nb-person-relationship">{meta.map((item, index) => <Fragment key={index}>{item}</Fragment>)}</div>
        </article>
    </div>;
}

function Location({ value, href }: { value: string; href?: string }) {
    const content = <><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span dir="auto">{value}</span></>;
    if (href) return <Link href={href} className="nb-meta nb-person-location" title={value} aria-label={`Location · ${value}`}>{content}</Link>;
    return <span className="nb-meta nb-person-location" title={value}>
        {content}
    </span>;
}

const EMPTY_SKILLS: string[] = [];

export function PersonCardSkillStrip({ labels, viewerSkills = EMPTY_SKILLS }: { labels: string[]; viewerSkills?: string[] }) {
    useSkillCatalog();
    const skills = useMemo(() => {
        const declared = personCardSkills(labels);
        const matched = new Set(matchingSkillLabels(declared, viewerSkills).map(canonicalSkillKey));
        return declared.sort((a, b) => Number(matched.has(canonicalSkillKey(b))) - Number(matched.has(canonicalSkillKey(a))))
            .map(name => ({ name, matched: matched.has(canonicalSkillKey(name)) }));
    }, [labels, viewerSkills]);
    const strip = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(Math.min(4, skills.length));
    const tag = (skill: typeof skills[number], index: number) => <span key={index} className="nb-tag nb-person-skill" data-matched={skill.matched || undefined} title={skill.name}>
        <SkillIcon skill={resolveClientSkill(skill.name)} size={14} className="nb-person-skill-icon" colorMode={skill.matched ? 'current' : 'brand'} />
        <span className="nb-person-skill-label" dir="auto">{skill.name}</span>{skill.matched ? <span className="sr-only">Matches your skills</span> : null}
    </span>;
    useLayoutEffect(() => {
        const element = strip.current;
        if (!element) return;
        const fit = () => {
            const samples = [...element.querySelectorAll<HTMLElement>('[data-measure] .nb-person-skill')];
            const more = element.querySelector<HTMLElement>('[data-measure-more]');
            if (!more) return;
            let count = 0;
            for (let n = Math.min(4, skills.length); n >= 0; n--) {
                more.textContent = `+${skills.length - n}`;
                const widths = samples.slice(0, n).reduce((total, el) => total + el.getBoundingClientRect().width, 0);
                const total = widths + Math.max(0, n - 1) * 5 + (skills.length > n ? more.getBoundingClientRect().width + (n ? 5 : 0) : 0);
                if (total <= element.clientWidth + .1) { count = n; break; }
            }
            setVisible(current => current === count ? current : count);
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(element);
        void document.fonts.ready.then(fit);
        return () => observer.disconnect();
    }, [skills]);
    if (!skills.length) return null;
    return <div ref={strip} className="nb-person-skill-strip" role="group" aria-label="Skills">
        {skills.slice(0, visible).map(tag)}
        {skills.length > visible ? <Dialog><DialogTrigger asChild>
            <button type="button" className="nb-tag nb-person-skill nb-person-more" aria-label={`Show ${skills.length - visible} more skills`}>+{skills.length - visible}</button>
        </DialogTrigger><DialogContent className="nb-person-dialog"><DialogHeader><DialogTitle>All skills</DialogTitle></DialogHeader>
            <p className="nb-compact text-muted-foreground">Highlighted skills match your profile.</p>
            <div className="nb-person-dialog-skills">{skills.map(tag)}</div>
        </DialogContent></Dialog> : null}
        <div data-measure aria-hidden="true" className="nb-person-measure">{skills.slice(0, 4).map(tag)}<span data-measure-more className="nb-tag nb-person-skill nb-person-more">+{skills.length}</span></div>
    </div>;
}

function SharedConnections({ person, count }: { person: PersonCardIdentity; count: number }) {
    const [open, setOpen] = useState(false);
    const [result, setResult] = useState<SharedConnectionsSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [offset, setOffset] = useState(0);
    const version = useRef(0);
    async function load(nextOffset: number) {
        if (!person.id) return;
        const current = ++version.current;
        setLoading(true); setError(null);
        try {
            const response = await readPersonSharedConnectionsAction({ targetId: person.id, offset: nextOffset });
            if (version.current !== current) return;
            if (!response.success) { setResult(null); setError(response.error); return; }
            setResult(response.summary); setOffset(nextOffset);
        } catch { if (version.current === current) { setResult(null); setError('Couldn’t load mutual connections. Try again.'); } }
        finally { if (version.current === current) setLoading(false); }
    }
    return <Dialog open={open} onOpenChange={next => { setOpen(next); setResult(null); setError(null); if (next) void load(0); else version.current++; }}>
        <DialogTrigger asChild><button type="button" className="nb-meta nb-person-shared" aria-label={`${CONNECTION_COPY.shared(count)} with ${personCardName(person)}`}>
            <Users className="size-3 shrink-0" aria-hidden="true" />
            <span className="nb-person-shared-full">{CONNECTION_COPY.shared(count)}</span>
            <span className="nb-person-shared-compact">{personCompactCount(count)} shared</span>
        </button></DialogTrigger>
        <DialogContent className="nb-person-dialog"><DialogHeader><DialogTitle>Mutual connections</DialogTitle></DialogHeader>
            {loading ? <p role="status" className="nb-compact flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading mutual connections…</p> : null}
            {error ? <div role="alert"><p className="nb-compact">{error}</p><button className="nb-person-control mt-3" onClick={() => void load(0)}>Retry</button></div> : null}
            {result ? <><p className="nb-meta">{result.total.toLocaleString('en')} shared {result.total === 1 ? 'connection' : 'connections'}</p>
                <div className="grid gap-3">{result.people.map(peer => <Link key={peer.id} href={profileHref(peer)} className="flex min-w-0 items-center gap-3 rounded-md">
                    <UserAvatar identity={peer} size={36} /><span className="nb-compact min-w-0 break-words">{personCardName(peer)}</span>
                </Link>)}</div>
                <div className="flex justify-between gap-3">
                    {offset > 0 ? <button disabled={loading} className="nb-person-control" onClick={() => void load(Math.max(0, offset - 20))}>Previous</button> : <span />}
                    {offset + result.people.length < result.total && offset < 10000 ? <button disabled={loading} className="nb-person-control" onClick={() => void load(offset + 20)}>Next</button> : null}
                </div></> : null}
        </DialogContent>
    </Dialog>;
}

/** Shared presentation only: callers retain their existing authenticated mutation handlers. */
export function PersonCardContent({ person: input, action, variant = 'network', viewerSkills, connected, acceptedAt, context, footer, priority, className }: {
    person: PersonCardIdentity; action: ReactNode; variant?: 'network' | 'rail'; viewerSkills?: string[];
    connected?: boolean; acceptedAt?: string | Date | null; context?: ReactNode; footer?: ReactNode; priority?: boolean; className?: string;
}) {
    if (input.isUnavailable) return null;
    const locked = input.isLockedProfile === true;
    const person = locked ? { ...input, headline: null, location: null, skills: [], portfolio: null, openToCollaborate: null, mutualConnections: null, lastActiveAt: null } : input;
    const name = personCardName(person), href = profileHref(person), subtitle = personCardSubtitle(person);
    const count = personSharedCount(person.mutualConnections), portfolio = personPortfolioText(person.portfolio), date = personConnectedDate(acceptedAt);
    // Only list cards are back-anchors; the Discover rail stays on screen beside the feed (unified back A4).
    return <PersonCardLayout variant={variant} className={className} restoreId={variant === 'network' && person.id ? `person:${person.id}` : undefined}
        avatar={<div className="relative"><Link href={href} tabIndex={-1} aria-hidden="true"><UserAvatar identity={person} size={48} priority={priority} /></Link>
            {!locked && person.id ? <PersonPresenceDot userId={person.id} lastActiveAt={person.lastActiveAt} /> : null}</div>}
        head={<h3 className="nb-person-name-line"><Link href={href} className="nb-person-name nb-pressable" title={name} dir="auto">{name}</Link>
            {person.openToCollaborate === true ? (
                <OpenToCollaborateBadge
                    openToCollaborate={person.openToCollaborate}
                    openTo={person.openTo}
                    customRoles={person.openToCustomRoles}
                    categories={person.preferredCategories}
                    experienceLevel={person.experienceLevel}
                    hoursPerWeek={person.hoursPerWeek}
                    variant="badge"
                />
            ) : null}
            {!locked && person.id ? (
                <SharedOrgChip userId={person.id} className="inline-flex max-w-[320px] max-sm:max-w-[200px] shrink-0 items-center truncate rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" />
            ) : null}</h3>}
        headline={subtitle.text ? <Link className={subtitle.kind === 'headline' ? 'nb-compact' : 'nb-meta'} href={subtitle.kind === 'portfolio' ? `${href}?tab=portfolio` : href} title={subtitle.text} dir="auto">
            {subtitle.kind === 'location' ? <Location value={subtitle.text} /> : subtitle.text}</Link> : null}
        location={!locked && ((person.location?.trim() && subtitle.kind !== 'location') || context || (portfolio && subtitle.kind !== 'portfolio')) ? <>
            {person.location?.trim() && subtitle.kind !== 'location' ? <Location value={person.location.trim()} href={href} /> : null}
            {context || (portfolio && subtitle.kind !== 'portfolio' ? <Link href={`${href}?tab=portfolio`} title={portfolio} className="nb-person-portfolio" aria-label={portfolio}>
                <span className="nb-person-portfolio-label">Portfolio <span>·</span></span><span dir="auto">{person.portfolio?.hasExternal ? 'View portfolio' : person.portfolio?.total === 1 && person.portfolio.projects[0]?.title.trim() ? person.portfolio.projects[0].title.trim() : `${person.portfolio?.total} ${person.portfolio?.total === 1 ? 'project' : 'projects'}`}</span>
            </Link> : null)}</> : null}
        body={!locked && personCardSkills(person.skills).length ? <PersonCardSkillStrip labels={person.skills ?? []} viewerSkills={viewerSkills} /> : null}
        meta={[
            count && person.id ? <SharedConnections key="shared" person={person} count={count} /> : null,
            connected ? <span key="connected" className="nb-meta nb-person-date" title={date.title}><span className="nb-person-date-full">{date.text}</span><span className="nb-person-date-compact">{date.compactText}</span></span> : footer,
        ]}
        aside={action}
    />;
}
