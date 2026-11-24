'use client';
import { CharCount } from "@/components/ui/CharCount";

import { InheritedAdminRows, NotInTeamFrame, UnitPeople, WorkspaceLeadRow } from '@/components/organizations/ChildTeamFields';
import { typeProfile } from '@/lib/organizations/type-profile'
import { useCreateLocation } from '@/components/organizations/CreateLocation';
import { OrgPeopleFields } from '@/components/organizations/OrgWizardFields';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { CreateWorkspaceInput, type OpenRoleInput } from '@/lib/validations/workspace';
import { WizardContextType } from '../useCreateWorkspaceWizard';
import { Check, ChevronUp, Pencil, Plus, X } from 'lucide-react';
import { PhaseHead } from '../PhaseHead';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabMarker } from '@/components/ui/TabMarker';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useAuth } from '@/hooks/use-auth';
import { useRoll } from '@/hooks/useRoll';
import { useFlip } from '@/hooks/useFlip';
import { useLeaving } from '@/hooks/useLeaving';
import { resolveClientSkill } from '@/lib/skills/client';

const fieldLabelClass = 'mb-2 block text-[13px] font-medium leading-[1.2] text-foreground';
const fieldClass = 'h-[var(--ui-control-height-lg)] bg-card text-[15px]';
const textAreaClass = 'min-h-24 w-full resize-y rounded-md border border-input bg-card px-[var(--ui-control-px)] py-3 text-[15px] leading-[1.5] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20';

const ROLE_OPTIONS = [
    'Frontend developer', 'Backend developer', 'Full stack developer', 'UI/UX designer',
    'Product manager', 'DevOps engineer', 'Data scientist', 'Mobile developer',
    'QA engineer', 'Technical writer', 'Marketing', 'Community manager',
];
const ROLE_SKILLS = ['React', 'TypeScript', 'Figma', 'Python', 'Node.js', 'Writing', 'SQL', 'Testing'];
const MY_ROLES = ['Product design', 'Frontend', 'Research', 'Project lead'];
const ROLE_SKILL_LIMIT = 8;
const ROLE_DESCRIPTION_MAX = 2000;

const EXPERIENCE_OPTIONS = [
    { value: 'any', label: 'Any level' },
    { value: 'junior', label: 'Junior' },
    { value: 'mid', label: 'Mid-level' },
    { value: 'senior', label: 'Senior' },
] as const;

const COMPENSATION_OPTIONS = [
    { value: 'unpaid', label: 'Unpaid (volunteer)' },
    { value: 'equity', label: 'Equity' },
    { value: 'paid', label: 'Paid' },
    { value: 'rev_share', label: 'Revenue share' },
] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const sameTitle = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

interface Phase3TeamRolesProps {
    wizardContext: WizardContextType;
    showValidationSummary?: boolean;
}

function FieldError({ id, message }: { id: string; message?: string }) {
    if (!message) return null;
    return <p id={id} role="alert" className="mt-1.5 text-[13px] leading-[1.5] text-destructive">{message}</p>;
}

function FieldLabel({ htmlFor, children, required = false }: { htmlFor: string; children: ReactNode; required?: boolean }) {
    return <label htmlFor={htmlFor} className={fieldLabelClass}>{children}{required ? <><span aria-hidden="true"> *</span><span className="sr-only"> (required)</span></> : null}</label>;
}

/** Openings: − n +, the number rolls (v6.6). */
function Stepper({ id, value, onChange, big = false }: { id?: string; value: number; onChange: (next: number) => void; big?: boolean }) {
    const shown = useRoll(value, 220);
    return (
        <span id={id} tabIndex={id ? -1 : undefined} className="nb-stepper" data-big={big || undefined} role="group" aria-label="Openings">
            <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Fewer openings">−</button>
            <b aria-live="polite">{shown}</b>
            <button type="button" onClick={() => onChange(value + 1)} disabled={value >= 10} aria-label="More openings">+</button>
        </span>
    );
}

/** One row of choices that reads as a radio group (Experience level, Compensation). */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (next: T) => void }) {
    return (
        <div className="nb-seg" data-size="sm" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>
            ))}
            <TabMarker />
        </div>
    );
}

/** The role's skills in one chip box (v6.2), names matched to the skill catalog, 8 at most. */
function RoleSkills({ id, skills, suggestions, onChange }: { id: string; skills: string[]; suggestions: string[]; onChange: (next: string[]) => void }) {
    const [draft, setDraft] = useState('');
    const [isLeaving, leave] = useLeaving();
    const skillsRef = useRef(skills);
    skillsRef.current = skills;
    const add = (raw: string) => {
        const name = raw.trim() ? resolveClientSkill(raw.trim()).name : '';
        setDraft('');
        if (!name || skills.length >= ROLE_SKILL_LIMIT || skills.some((s) => sameTitle(s, name))) return;
        onChange([...skills, name]);
    };
    return (
        <>
            <div className="flex items-end justify-between gap-3">
                <FieldLabel htmlFor={id}>Skills</FieldLabel>
                <CharCount value={skills.length} max={ROLE_SKILL_LIMIT} className="mb-2 shrink-0" />
            </div>
            <div className="nb-chipbox" aria-label="Skills for this role">
                {skills.map((skill) => (
                    <span key={skill} className="nb-tag nb-enter-chip" data-leaving={isLeaving(skill) || undefined}>
                        <span className="truncate">{skill}</span>
                        <button type="button" className="nb-chip-x" onClick={() => leave(skill, () => onChange(skillsRef.current.filter((s) => s !== skill)))} aria-label={`Remove ${skill}`}><X className="size-3" aria-hidden="true" /></button>
                    </span>
                ))}
                {skills.length < ROLE_SKILL_LIMIT ? (
                    <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
                        placeholder={skills.length ? 'Add another' : 'Type a skill and press Enter'} />
                ) : null}
            </div>
            {skills.length < ROLE_SKILL_LIMIT ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="Suggested skills">
                    <span className="nb-meta mr-1">suggested</span>
                    {suggestions.filter((s) => !skills.some((x) => sameTitle(x, s))).slice(0, 6).map((s) => (
                        <button key={s} type="button" className="nb-tag-add" onClick={() => add(s)}>+ {s}</button>
                    ))}
                </div>
            ) : null}
            <p className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">The skills a contributor will use in this role.</p>
        </>
    );
}

export default function Phase3TeamRoles({ wizardContext, showValidationSummary = false }: Phase3TeamRolesProps) {
    const { setValue, watch, formState: { errors } } = useFormContext<CreateWorkspaceInput>();
    const { openRoles, openRoleIds, addRole, updateRole, removeRole, duplicateRole, moveRole, prefillUnits } = wizardContext;
    const { org } = useCreateLocation();
    const { profile } = useAuth();
    // Default units pre-fill an empty team (report §14.4 additions); Education hides compensation (§14.4).
    useEffect(() => { if (org?.defaultUnits?.length) prefillUnits(org.id, org.defaultUnits); }, [org?.id, org?.defaultUnits, prefillUnits]);
    const showCompensation = !org || typeProfile(org.orgType).showCompensation;
    const creatorRole = watch('creator_role');
    const leadFocus = creatorRole?.title || '';
    const leadId = watch('lead_user_id');
    const infoSkills = watch('technologies_used') || [];

    // One role open at a time (v6.2). A new or duplicated role opens once its row exists.
    const [openId, setOpenId] = useState<string | null>(null);
    const [composer, setComposer] = useState('');
    const [allPopular, setAllPopular] = useState(false);
    const pendingOpen = useRef<{ index: number; focus: 'title' | 'description' } | null>(null);
    const focusGrip = useRef<number | null>(null);
    const dragFrom = useRef<number | null>(null);
    const focusOnOpen = useRef<string | null>(null);
    const rolesRef = useRef<HTMLOListElement>(null);
    const flip = useFlip(rolesRef);
    // Opening or closing a role moves the rows under it: they slide (v6.6 motion).
    const openRole = (id: string | null) => { flip(); setOpenId(id); };
    useEffect(() => {
        const pending = pendingOpen.current;
        if (pending && openRoleIds[pending.index]) {
            pendingOpen.current = null;
            const id = openRoleIds[pending.index]!;
            focusOnOpen.current = pending.focus === 'title' ? `create-project-role-${id}` : `create-project-role-description-${id}`;
            flip();
            setOpenId(id);
        }
        if (focusGrip.current !== null) {
            const index = focusGrip.current;
            focusGrip.current = null;
            setTimeout(() => (document.querySelectorAll<HTMLElement>('[data-role-grip]')[index])?.focus(), 0);
        }
    }, [openRoleIds]);
    // Focus the new role's field once its editor has rendered (a timer can run before the commit in WebKit).
    useEffect(() => {
        if (!focusOnOpen.current) return;
        document.getElementById(focusOnOpen.current)?.focus();
        focusOnOpen.current = null;
    }, [openId]);

    const startRole = (title = '') => {
        const role = title.trim();
        if (role && openRoles.some((r) => sameTitle(r.role, role))) return;
        pendingOpen.current = { index: openRoles.length, focus: role ? 'description' : 'title' };
        addRole(role ? { role } : undefined);
        setComposer('');
    };
    const reorder = (from: number, to: number) => {
        if (to < 0 || to >= openRoles.length || from === to) return;
        focusGrip.current = to;
        moveRole(from, to);
    };

    const roleErrors = Array.isArray(errors.roles) ? errors.roles : [];
    const openPositionCount = openRoles.reduce((total, role) => total + role.count, 0);
    const duplicateOf = (index: number) => {
        const title = openRoles[index]?.role ?? '';
        return title.trim() ? openRoles.findIndex((candidate, i) => i !== index && sameTitle(candidate.role, title)) : -1;
    };
    const validationErrors = roleErrors.flatMap((roleError, index) => {
        const roleId = openRoleIds[index] || `role-${index}`;
        const items: Array<{ id: string; roleId: string; message: string }> = [];
        if (roleError?.role?.message) items.push({ id: `create-project-role-${roleId}`, roleId, message: `Role ${index + 1}: ${roleError.role.message}` });
        if (roleError?.count?.message) items.push({ id: `create-project-role-count-${roleId}`, roleId, message: `Role ${index + 1}: ${roleError.count.message}` });
        return items;
    });
    const unusedPopular = ROLE_OPTIONS.filter((option) => !openRoles.some((r) => sameTitle(r.role, option)));
    const popular = allPopular ? unusedPopular : unusedPopular.slice(0, 6);
    const myName = (profile as { fullName?: string; full_name?: string } | null)?.fullName || (profile as { full_name?: string } | null)?.full_name || 'You';
    const myHandle = (profile as { username?: string } | null)?.username;

    const updateLeadFocus = (title: string) => {
        setValue('creator_role', {
            title, time_commitment: creatorRole?.time_commitment,
        }, { shouldDirty: true, shouldValidate: true });
    };

    if (watch('organization')) {
        return (
            <div className="min-w-0 w-full space-y-8 pb-6">
                <PhaseHead noun="organization" step="People" title="Who runs it, and how people get in." line="Role names are yours to choose; what each role can do stays the same." />
                <OrgPeopleFields />
            </div>
        );
    }

    return (
        <div className="min-w-0 w-full pb-6">
            <PhaseHead noun="workspace" step="Team" title="Who’s building it?" line={org ? `Roles here are teams inside ${org.title}. Add its people now, or open roles for help you want.` : 'You own it. Add openings only for help you want now; people see them as Apply on Discover.'} />

            {showValidationSummary && validationErrors.length > 0 ? (
                <div role="alert" aria-live="assertive" className="nb-enter-reveal mt-6 bg-[var(--status-danger-soft)] px-4 py-3 text-[13px] leading-[1.5] text-foreground">
                    <p className="font-semibold">Complete or remove the unfinished roles</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {validationErrors.map((err) => (
                            <li key={err.id}>
                                <a
                                    href={`#${err.id}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        setOpenId(err.roleId);
                                        setTimeout(() => {
                                            const el = document.getElementById(err.id);
                                            el?.focus();
                                            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        }, 0);
                                    }}
                                    className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    {err.message}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <section aria-labelledby="project-lead-heading" className="nbs-frame">
                <p id="project-lead-heading" className="nbs-glabel pt-[18px]">{org ? 'Owner and lead' : 'Owner'}</p>
                <div className="nb-person">
                    <UserAvatar identity={profile as never} size={40} fallbackDisplayName={myName} />
                    <span className="min-w-0">
                        <b>{myName}</b> <span className={`nbs-tag${leadId ? '' : ' hot'}`}>{leadId ? 'Admin' : 'Owner'}</span>
                        <span className="nb-person-hint">{myHandle ? `@${myHandle} · ` : ''}{leadId && org ? `admin through ${org.title}` : 'every setting, transfer, archive'}</span>
                    </span>
                </div>
                <WorkspaceLeadRow />
                <div className="nb-fld">
                    <div className="flex items-end justify-between gap-3">
                        <FieldLabel htmlFor="create-project-lead-focus">Your role here</FieldLabel>
                        <CharCount value={leadFocus.length} max={80} className="mb-2 shrink-0" />
                    </div>
                    <Input
                        id="create-project-lead-focus"
                        value={leadFocus}
                        onChange={(event) => updateLeadFocus(event.target.value)}
                        placeholder="For example, Product, design, or frontend"
                        maxLength={80}
                        className={fieldClass}
                        aria-describedby="create-project-lead-focus-help"
                    />
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {MY_ROLES.filter((role) => role !== leadFocus).map((role) => (
                            <button key={role} type="button" className="nb-tag-add" onClick={() => updateLeadFocus(role)}>+ {role}</button>
                        ))}
                    </div>
                    <p id="create-project-lead-focus-help" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">Optional. What you do here, shown beside your name.</p>
                </div>
            </section>

            <section aria-labelledby="open-roles-heading" className="nbs-frame">
                <p id="open-roles-heading" className="nbs-glabel pt-[18px]">
                    Open roles
                    <span className="r"><span className="font-mono text-[12px] tabular-nums text-muted-foreground">{pad(openRoles.length)} {openRoles.length === 1 ? 'role' : 'roles'} · {pad(openPositionCount)} {openPositionCount === 1 ? 'opening' : 'openings'}</span></span>
                </p>

                {openRoles.length === 0 ? (
                    <div className="nb-roles-empty">
                        <b>No openings yet</b>
                        <span>You can create it without recruiting. Add a role when you know what help the work needs.</span>
                    </div>
                ) : (
                    <ol ref={rolesRef} className="nb-roles">
                        {openRoles.map((role, index) => {
                            const roleError = roleErrors[index];
                            const roleId = openRoleIds[index] || `role-${index}`;
                            const isOpen = openId === roleId;
                            const roleTitleId = `create-project-role-${roleId}`;
                            const roleCountId = `create-project-role-count-${roleId}`;
                            const roleDescriptionId = `create-project-role-description-${roleId}`;
                            const roleTitleErrorId = `${roleTitleId}-error`;
                            const dup = duplicateOf(index);
                            const duplicateRoleMessage = dup >= 0 ? `This matches role ${dup + 1}. Use one role per title.` : undefined;
                            const titled = Boolean(role.role.trim());
                            const experience = EXPERIENCE_OPTIONS.find((option) => option.value === (role.experienceLevel || 'any'))?.label;
                            const compensation = COMPENSATION_OPTIONS.find((option) => option.value === (role.compensationType || 'unpaid'))?.label;
                            const leadName = role.lead_user_id ? role.people?.find((p) => p.user_id === role.lead_user_id)?.label : undefined;
                            const meta = titled ? [
                                `${role.count} ${role.count === 1 ? 'opening' : 'openings'}`,
                                experience,
                                showCompensation ? compensation : null,
                                role.skills?.length ? `${role.skills.length} ${role.skills.length === 1 ? 'skill' : 'skills'}` : null,
                                org ? `${role.people?.length ?? 0} / 10 seats` : null,
                                leadName ? `lead · ${leadName.split(' ')[0]}` : null,
                            ].filter((item): item is string => Boolean(item)) : [];
                            const pops = ROLE_OPTIONS.filter((option) => !openRoles.some((r, i) => i !== index && sameTitle(r.role, option)) && !sameTitle(role.role, option)).slice(0, 6);

                            return (
                                <li key={roleId} id={`role-${roleId}`} data-role-row data-flip={roleId} className={`nb-role${isOpen ? ' open' : ''}${roleError || dup >= 0 ? ' bad' : ''}`}
                                    onDragOver={(event) => { if (dragFrom.current !== null) event.preventDefault(); }}
                                    onDrop={(event) => { event.preventDefault(); if (dragFrom.current !== null) reorder(dragFrom.current, index); dragFrom.current = null; }}>
                                    <div className="nb-role-row">
                                        <span data-role-grip className="nb-role-n" draggable tabIndex={0} role="button"
                                            title="Drag, or use the arrow keys, to reorder" aria-label={`Role ${index + 1}. Move with the arrow keys.`}
                                            onDragStart={(event) => { dragFrom.current = index; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
                                            onDragEnd={() => { dragFrom.current = null; }}
                                            onKeyDown={(event) => {
                                                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1)); }
                                            }}>{pad(index + 1)}</span>
                                        <span className="min-w-0">
                                            <b className="font-medium">{titled ? role.role : <span className="text-muted-foreground">Untitled role</span>}</b>
                                            {!titled ? <span className="nbs-tag warn ml-2">Incomplete</span> : dup >= 0 ? <span className="nbs-tag bad ml-2">Same title</span> : null}
                                            {meta.length ? <span className="nb-role-meta">{meta.map((m) => <span key={m} className="nbs-tag">{m}</span>)}</span> : null}
                                        </span>
                                        <span className="nb-role-ctl">
                                            {isOpen ? null : <Stepper value={role.count} onChange={(count) => updateRole(index, { count: Math.min(10, Math.max(1, count)) })} />}
                                            <button type="button" className="nbs-ib" aria-expanded={isOpen} aria-label={`${isOpen ? 'Close' : 'Edit'} ${role.role.trim() || 'role'}`} onClick={() => openRole(isOpen ? null : roleId)}>
                                                {isOpen ? <ChevronUp aria-hidden="true" /> : <Pencil aria-hidden="true" />}
                                            </button>
                                            {isOpen ? null : (
                                                <button type="button" className="nbs-ib danger" aria-label={`Remove ${role.role.trim() || 'role'}`} onClick={() => removeRole(index)}><X aria-hidden="true" /></button>
                                            )}
                                        </span>
                                    </div>

                                    {isOpen ? (
                                        <div data-role-editor className="nb-role-ed nb-enter-reveal">
                                            <p className="nbs-glabel pt-[18px]">Basics</p>
                                            <div className="nb-role-basics">
                                                <div className="nb-fld nb-fld-first">
                                                    <FieldLabel htmlFor={roleTitleId} required>Role title</FieldLabel>
                                                    <Input
                                                        id={roleTitleId}
                                                        value={role.role}
                                                        onChange={(event) => updateRole(index, { role: event.target.value })}
                                                        placeholder="For example, Frontend developer"
                                                        maxLength={100}
                                                        className={fieldClass}
                                                        aria-invalid={Boolean(roleError?.role || duplicateRoleMessage)}
                                                        aria-describedby={roleError?.role || duplicateRoleMessage ? roleTitleErrorId : undefined}
                                                    />
                                                    <FieldError id={roleTitleErrorId} message={duplicateRoleMessage || roleError?.role?.message} />
                                                    {duplicateRoleMessage ? null : (
                                                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="Popular roles">
                                                            <span className="nb-meta mr-1">popular</span>
                                                            {pops.map((option) => <button key={option} type="button" className="nb-tag-add" onClick={() => updateRole(index, { role: option })}>+ {option}</button>)}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="nb-fld nb-fld-first">
                                                    <p className={fieldLabelClass}>Openings<span aria-hidden="true"> *</span><span className="sr-only"> (required)</span></p>
                                                    <Stepper id={roleCountId} big value={role.count} onChange={(count) => updateRole(index, { count: Math.min(10, Math.max(1, count)) })} />
                                                    <p className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">One to ten people.</p>
                                                    <FieldError id={`${roleCountId}-error`} message={roleError?.count?.message} />
                                                </div>
                                            </div>
                                            <div className="nb-fld">
                                                <div className="flex items-end justify-between gap-3">
                                                    <FieldLabel htmlFor={roleDescriptionId}>Role description</FieldLabel>
                                                    <CharCount value={(role.description || '').length} max={ROLE_DESCRIPTION_MAX} className="mb-2 shrink-0" />
                                                </div>
                                                <textarea
                                                    id={roleDescriptionId}
                                                    value={role.description || ''}
                                                    onChange={(event) => updateRole(index, { description: event.target.value })}
                                                    rows={3}
                                                    maxLength={ROLE_DESCRIPTION_MAX}
                                                    className={textAreaClass}
                                                    placeholder="Describe the work this person will own and the outcome they should help deliver."
                                                />
                                            </div>

                                            <p className="nbs-glabel pt-4">Requirements</p>
                                            <div className="nb-fld nb-fld-first">
                                                <RoleSkills id={`${roleId}-skills`} skills={role.skills || []} suggestions={[...infoSkills, ...ROLE_SKILLS]} onChange={(skills) => updateRole(index, { skills })} />
                                            </div>
                                            <div className="nbs-row">
                                                <div><p className="t">Experience level</p><p className="d">Who you’re looking for.</p></div>
                                                <div className="ctl"><Segmented label="Experience level" value={role.experienceLevel || 'any'} options={EXPERIENCE_OPTIONS} onChange={(experienceLevel) => updateRole(index, { experienceLevel: experienceLevel as OpenRoleInput['experienceLevel'] })} /></div>
                                            </div>

                                            <p className="nbs-glabel pt-4">Offer</p>
                                            {showCompensation ? (
                                                <>
                                                    <div className="nbs-row nb-row-first">
                                                        <div><p className="t">Compensation</p><p className="d">Shown on the opening.</p></div>
                                                        <div className="ctl"><Segmented label="Compensation" value={role.compensationType || 'unpaid'} options={COMPENSATION_OPTIONS} onChange={(compensationType) => updateRole(index, { compensationType: compensationType as OpenRoleInput['compensationType'] })} /></div>
                                                    </div>
                                                    {role.compensationType && role.compensationType !== 'unpaid' ? (
                                                        <div className="nb-fld nb-enter-reveal">
                                                            <FieldLabel htmlFor={`${roleId}-compensation-details`}>Compensation details</FieldLabel>
                                                            <Input
                                                                id={`${roleId}-compensation-details`}
                                                                value={role.compensationDetails || ''}
                                                                onChange={(event) => updateRole(index, { compensationDetails: event.target.value })}
                                                                placeholder="For example, hourly range, equity range, or revenue-share terms"
                                                                maxLength={500}
                                                                className={fieldClass}
                                                            />
                                                        </div>
                                                    ) : null}
                                                </>
                                            ) : (
                                                <div className="nbs-row nb-row-first">
                                                    <div><p className="t">No compensation</p><p className="d">{org?.title} is a class, so its roles don’t show pay.</p></div>
                                                </div>
                                            )}

                                            <UnitPeople index={index} unitName={role.role} />

                                            <div className="nb-role-bar">
                                                <button type="button" className="nb-role-remove" onClick={() => { removeRole(index); setOpenId(null); }}>Remove role</button>
                                                <Button type="button" variant="ghost" size="sm" onClick={() => { pendingOpen.current = { index: index + 1, focus: 'title' }; duplicateRole(index); }}>Duplicate</Button>
                                                <span className="nb-role-saved">{titled ? 'saved as you type' : 'a title is required'}</span>
                                                <Button type="button" size="sm" onClick={() => openRole(null)}><Check className="size-4" aria-hidden="true" />Done</Button>
                                            </div>
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ol>
                )}

                <div className="nb-composer">
                    <div className="nb-composer-grid">
                        <Input value={composer} onChange={(e) => setComposer(e.target.value)} aria-label="New role title" placeholder="Add a role, for example Frontend developer" autoComplete="off" maxLength={100}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); startRole(composer); } }} className={fieldClass} />
                        <Button type="button" variant="outline" onClick={() => startRole(composer)}><Plus className="size-4" aria-hidden="true" />Add role</Button>
                    </div>
                    {unusedPopular.length ? (
                        <div data-popular-roles className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="Popular roles">
                            <span className="nb-meta mr-1">popular</span>
                            {popular.map((option) => <button key={option} type="button" className="nb-tag-add" onClick={() => startRole(option)}>+ {option}</button>)}
                            {!allPopular && unusedPopular.length > 6 ? <button type="button" data-more className="nb-tag-add" onClick={() => setAllPopular(true)}>{unusedPopular.length - 6} more</button> : null}
                        </div>
                    ) : null}
                </div>
            </section>
            <NotInTeamFrame />
            <InheritedAdminRows />
        </div>
    );
}
