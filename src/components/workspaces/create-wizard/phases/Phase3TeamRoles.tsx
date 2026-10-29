'use client';

import { ChildLeadAndUnassigned, InheritedAdminRows, UnitPeople } from '@/components/organizations/ChildTeamFields';
import { useCreateLocation } from '@/components/organizations/CreateLocation';
import { OrgPeopleFields } from '@/components/organizations/OrgWizardFields';
import { type ReactNode, useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { CreateWorkspaceInput, type OpenRoleInput } from '@/lib/validations/workspace';
import { WizardContextType } from '../useCreateWorkspaceWizard';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { SkillPicker } from '@/components/skills/SkillPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const fieldLabelClass = 'mb-2 block text-[13px] font-medium leading-[1.2] text-foreground';
const fieldClass = 'h-[var(--ui-control-height-lg)] bg-card text-[15px]';
const textAreaClass = 'min-h-28 w-full resize-y rounded-md border border-input bg-card px-[var(--ui-control-px)] py-3 text-[15px] leading-[1.5] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20';

const ROLE_OPTIONS = [
    'Frontend developer', 'Backend developer', 'Full stack developer', 'UI/UX designer',
    'Product manager', 'DevOps Engineer', 'Data scientist', 'Mobile developer',
    'QA engineer', 'Technical writer', 'Marketing', 'Community manager',
];

const EXPERIENCE_OPTIONS = [
    { value: 'any', label: 'Any experience level' },
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

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description: string; id: string }) {
    return (
        <div className="max-w-[65ch]">
            <p className="nb-micro text-primary">{eyebrow}</p>
            <h3 id={id} className="nb-card-title mt-1 text-foreground">{title}</h3>
            <p className="nb-compact mt-1 text-muted-foreground">{description}</p>
        </div>
    );
}

export default function Phase3TeamRoles({ wizardContext, showValidationSummary = false }: Phase3TeamRolesProps) {
    const { getValues, setValue, watch, formState: { errors } } = useFormContext<CreateWorkspaceInput>();
    const { openRoles, openRoleIds, addRole, updateRole, removeRole, prefillUnits } = wizardContext;
    const { org } = useCreateLocation();
    // Default units pre-fill an empty team (report §14.4 additions); Education hides compensation (§14.4).
    useEffect(() => { if (org?.defaultUnits?.length) prefillUnits(org.id, org.defaultUnits); }, [org?.id, org?.defaultUnits, prefillUnits]);
    const showCompensation = org?.orgType !== 'education';
    const creatorRole = watch('creator_role');
    const leadFocus = creatorRole?.title || '';
    const [roleSuggestionsOpen, setRoleSuggestionsOpen] = useState<Record<string, boolean>>({});
    const roleErrors = Array.isArray(errors.roles) ? errors.roles : [];
    const openPositionCount = openRoles.reduce((total, role) => total + role.count, 0);
    const validationErrors = roleErrors.flatMap((roleError, index) => {
        const roleId = openRoleIds[index] || `role-${index}`;
        const items: Array<{ id: string; message: string }> = [];
        if (roleError?.role?.message) {
            items.push({ id: `create-project-role-${roleId}`, message: `Role ${index + 1}: ${roleError.role.message}` });
        }
        if (roleError?.count?.message) {
            items.push({ id: `create-project-role-count-${roleId}`, message: `Role ${index + 1}: ${roleError.count.message}` });
        }
        return items;
    });

    const updateLeadFocus = (title: string) => {
        setValue('creator_role', {
            title, time_commitment: creatorRole?.time_commitment,
        }, { shouldDirty: true, shouldValidate: true });
    };

    if (watch('organization')) {
        return (
            <div className="min-w-0 w-full space-y-8 pb-6">
                <div className="max-w-[65ch]">
                    <p className="nb-micro text-primary">Phase 3 · people</p>
                    <h2 className="nb-section-title mt-1 text-foreground">Members and access</h2>
                    <p className="nb-compact mt-1.5 text-muted-foreground">Who runs it, what the roles are called, and how people get in.</p>
                </div>
                <OrgPeopleFields />
            </div>
        );
    }

    return (
        <div className="min-w-0 w-full space-y-8 pb-6">
            <div className="max-w-[65ch]">
                <p className="nb-micro text-primary">Phase 3 · team</p>
                <h2 className="nb-section-title mt-1 text-foreground">Set up your team</h2>
                <p className="nb-compact mt-1.5 text-muted-foreground">Confirm your role, then add only the open roles you plan to fill now.</p>
            </div>

            {showValidationSummary && validationErrors.length > 0 ? (
                <div role="alert" aria-live="assertive" className="border-l-2 border-destructive bg-[var(--status-danger-soft)] px-4 py-3 text-[13px] leading-[1.5] text-foreground">
                    <p className="font-semibold">Complete or remove the unfinished roles</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {validationErrors.map((err) => (
                            <li key={err.id}>
                                <a
                                    href={`#${err.id}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        const el = document.getElementById(err.id);
                                        el?.focus();
                                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

            <section aria-labelledby="project-lead-heading" className="border-t border-border pt-6">
                <SectionHeading
                    id="project-lead-heading"
                    eyebrow="Access"
                    title="Owner"
                    description="You’ll own this workspace. You can make others admins later, or transfer ownership."
                />
                <div className="mt-5 grid gap-5 border-y border-border py-5 md:grid-cols-[minmax(11rem,0.42fr)_minmax(0,1fr)] md:gap-6">
                    <div>
                        <p className="nb-label">Access level</p>
                        <p className="nb-card-title mt-2 text-foreground">Owner · 1 person</p>
                        <p className="nb-compact mt-1 max-w-[34ch] text-muted-foreground">You can change every setting, transfer ownership, or archive and delete the workspace.</p>
                    </div>
                    <div>
                        <div className="flex items-end justify-between gap-3">
                            <FieldLabel htmlFor="create-project-lead-focus">Your role in this workspace</FieldLabel>
                            <span className="nb-meta mb-2 shrink-0 tabular-nums text-muted-foreground">{leadFocus.length}/80</span>
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
                        <p id="create-project-lead-focus-help" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">Optional. What you do here, for example Product design.</p>
                    </div>
                </div>
            </section>

            <section aria-labelledby="open-roles-heading" className="border-t border-border pt-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <SectionHeading
                        id="open-roles-heading"
                        eyebrow="Open roles"
                        title="Set up your team"
                        description="Openings are optional. Define a role only when you are ready to make it visible to potential contributors."
                    />
                    <div className="flex items-center gap-3">
                        <span className="nb-meta shrink-0 tabular-nums text-muted-foreground">
                            {openRoles.length} {openRoles.length === 1 ? 'role' : 'roles'} · {openPositionCount} {openPositionCount === 1 ? 'opening' : 'openings'}
                        </span>
                        <Button type="button" variant="outline" onClick={addRole}><Plus className="size-4" aria-hidden="true" />Add role</Button>
                    </div>
                </div>

                {openRoles.length === 0 ? (
                    <div className="mt-5 border-y border-border py-5">
                        <p className="nb-card-title text-foreground">No openings added</p>
                        <p className="nb-compact mt-1 max-w-[60ch] text-muted-foreground">You can create the workspace without recruiting. Add roles here when you know what help the work needs.</p>
                    </div>
                ) : (
                    <ol className="mt-5 border-t border-border">
                        {openRoles.map((role, index) => {
                            const roleError = roleErrors[index];
                            const roleId = openRoleIds[index] || `role-${index}`;
                            const roleTitleId = `create-project-role-${roleId}`;
                            const roleCountId = `create-project-role-count-${roleId}`;
                            const roleDescriptionId = `create-project-role-description-${roleId}`;
                            const roleTitleErrorId = `${roleTitleId}-error`;
                            const roleCountErrorId = `${roleCountId}-error`;
                            const normalizedRoleTitle = role.role.trim().toLocaleLowerCase();
                            const duplicateRoleIndex = normalizedRoleTitle
                                ? openRoles.findIndex((candidate, candidateIndex) => candidateIndex !== index && candidate.role.trim().toLocaleLowerCase() === normalizedRoleTitle)
                                : -1;
                            const duplicateRoleMessage = duplicateRoleIndex >= 0 ? `This matches open role ${duplicateRoleIndex + 1}. Use one role per title.` : undefined;
                            const roleComplete = Boolean(normalizedRoleTitle) && role.count >= 1 && role.count <= 10 && !duplicateRoleMessage;
                            const experienceLabel = EXPERIENCE_OPTIONS.find((option) => option.value === (role.experienceLevel || 'any'))?.label;
                            const compensationLabel = COMPENSATION_OPTIONS.find((option) => option.value === (role.compensationType || 'unpaid'))?.label;
                            const optionalDetailSummary = [
                                role.skills?.length ? `${role.skills.length} ${role.skills.length === 1 ? 'skill' : 'skills'}` : null,
                                role.experienceLevel && role.experienceLevel !== 'any' ? experienceLabel : null,
                                role.compensationType && role.compensationType !== 'unpaid' ? compensationLabel : null,
                            ].filter((item): item is string => Boolean(item)).join(' · ') || 'Optional details';

                            return (
                                <li key={roleId} className="border-b border-border py-6">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="nb-micro text-muted-foreground">Open role {String(index + 1).padStart(2, '0')}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <p className="nb-compact text-muted-foreground">{role.count} {role.count === 1 ? 'position' : 'positions'} available</p>
                                                {roleComplete ? <span className="rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.09em] text-muted-foreground">Required details complete</span> : null}
                                            </div>
                                        </div>
                                        <Button type="button" onClick={() => removeRole(index)} variant="ghost" size="icon-sm" className="nb-touch-target text-muted-foreground hover:text-destructive" aria-label={`Remove open role ${index + 1}`}>
                                            <Trash2 className="size-4" aria-hidden="true" />
                                        </Button>
                                    </div>

                                    <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_12rem]">
                                        <div>
                                            <FieldLabel htmlFor={roleTitleId} required>Role title</FieldLabel>
                                            <Input
                                                id={roleTitleId}
                                                value={role.role}
                                                onChange={(event) => updateRole(index, { role: event.target.value })}
                                                placeholder="For example, Frontend developer"
                                                className={fieldClass}
                                                aria-invalid={Boolean(roleError?.role || duplicateRoleMessage)}
                                                aria-describedby={roleError?.role || duplicateRoleMessage ? roleTitleErrorId : undefined}
                                                autoFocus={index === openRoles.length - 1 && !role.role}
                                            />
                                            <FieldError id={roleTitleErrorId} message={roleError?.role?.message || duplicateRoleMessage} />
                                            <button
                                                type="button"
                                                aria-expanded={Boolean(roleSuggestionsOpen[roleId])}
                                                aria-controls={`${roleId}-suggestions`}
                                                onClick={() => setRoleSuggestionsOpen((open) => ({ ...open, [roleId]: !open[roleId] }))}
                                                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                                            >
                                                Popular roles
                                                <ChevronDown className={`size-3.5 transition-transform duration-[180ms] ${roleSuggestionsOpen[roleId] ? 'rotate-180' : ''}`} aria-hidden="true" />
                                            </button>
                                            {roleSuggestionsOpen[roleId] ? <div id={`${roleId}-suggestions`} className="mt-2 flex flex-wrap gap-1.5" aria-label="Popular role suggestions">
                                                {ROLE_OPTIONS.slice(0, 6).map((suggestion) => {
                                                    const usedByAnotherRole = openRoles.some((candidate, candidateIndex) => candidateIndex !== index && candidate.role.trim().toLocaleLowerCase() === suggestion.toLocaleLowerCase());
                                                    return (
                                                    <button
                                                        key={suggestion}
                                                        type="button"
                                                        disabled={usedByAnotherRole}
                                                        onClick={() => {
                                                            updateRole(index, { role: suggestion });
                                                            setRoleSuggestionsOpen((open) => ({ ...open, [roleId]: false }));
                                                        }}
                                                        className="rounded-[3px] border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-40"
                                                    >{suggestion}</button>
                                                );
                                                })}
                                            </div> : null}
                                        </div>
                                        <div>
                                            <FieldLabel htmlFor={roleCountId} required>Open roles</FieldLabel>
                                            <Input
                                                id={roleCountId}
                                                type="number"
                                                min={1}
                                                max={10}
                                                step={1}
                                                inputMode="numeric"
                                                value={role.count}
                                                onChange={(event) => {
                                                    const parsed = Number.parseInt(event.target.value, 10);
                                                    updateRole(index, { count: Number.isFinite(parsed) ? Math.min(10, Math.max(1, parsed)) : 1 });
                                                }}
                                                className={fieldClass}
                                                aria-invalid={Boolean(roleError?.count)}
                                                aria-describedby={roleError?.count ? roleCountErrorId : undefined}
                                            />
                                            <p className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">One to ten openings.</p>
                                            <FieldError id={roleCountErrorId} message={roleError?.count?.message} />
                                        </div>
                                        <div className="md:col-span-2">
                                            <FieldLabel htmlFor={roleDescriptionId}>Role description</FieldLabel>
                                            <textarea
                                                id={roleDescriptionId}
                                                value={role.description || ''}
                                                onChange={(event) => updateRole(index, { description: event.target.value })}
                                                rows={3}
                                                className={textAreaClass}
                                                placeholder="Describe the work this person will own and the outcome they should help deliver."
                                            />
                                        </div>
                                    </div>

                                    <details className="group mt-5 border-t border-border pt-4">
                                        <summary className="flex min-h-[var(--ui-control-height-lg)] cursor-pointer list-none items-center justify-between gap-4 rounded-md border border-border bg-secondary/55 px-4 py-2.5 text-[13px] font-medium text-foreground transition-[background-color,border-color,box-shadow] duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:border-input hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-details-marker]:hidden">
                                            <span className="inline-flex min-w-0 items-center gap-2">
                                                <span>Role requirements and offer</span>
                                                <span className="nb-meta shrink-0 text-muted-foreground">{optionalDetailSummary}</span>
                                            </span>
                                            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-[180ms] group-open:rotate-180" aria-hidden="true" />
                                        </summary>
                                        <div className="mt-5 space-y-5">
                                            <SkillPicker
                                                value={role.skills || []}
                                                onChange={(skills) => updateRole(index, { skills })}
                                                label="Skills"
                                                description="Add the skills a contributor will use in this role."
                                                maxSkills={8}
                                                compact
                                                progressive
                                                placeholder="Search skills for this role"
                                            />
                                            <div className="grid gap-5 md:grid-cols-2">
                                                <div>
                                                    <FieldLabel htmlFor={`${roleId}-experience`}>Experience level</FieldLabel>
                                                    <Select value={role.experienceLevel || 'any'} onValueChange={(experienceLevel) => updateRole(index, { experienceLevel: experienceLevel as OpenRoleInput['experienceLevel'] })}>
                                                        <SelectTrigger id={`${roleId}-experience`} className={fieldClass}><SelectValue /></SelectTrigger>
                                                        <SelectContent>{EXPERIENCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                                                    </Select>
                                                </div>
                                                {showCompensation ? <div>
                                                    <FieldLabel htmlFor={`${roleId}-compensation`}>Compensation</FieldLabel>
                                                    <Select value={role.compensationType || 'unpaid'} onValueChange={(compensationType) => updateRole(index, { compensationType: compensationType as OpenRoleInput['compensationType'] })}>
                                                        <SelectTrigger id={`${roleId}-compensation`} className={fieldClass}><SelectValue /></SelectTrigger>
                                                        <SelectContent>{COMPENSATION_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                                                    </Select>
                                                </div> : null}
                                            </div>
                                            {showCompensation && role.compensationType && role.compensationType !== 'unpaid' ? (
                                                <div>
                                                    <FieldLabel htmlFor={`${roleId}-compensation-details`}>Compensation details</FieldLabel>
                                                    <Input
                                                        id={`${roleId}-compensation-details`}
                                                        value={role.compensationDetails || ''}
                                                        onChange={(event) => updateRole(index, { compensationDetails: event.target.value })}
                                                        placeholder="For example, hourly range, equity range, or revenue-share terms"
                                                        className={fieldClass}
                                                    />
                                                </div>
                                            ) : null}
                                        </div>
                                    </details>
                                    <UnitPeople index={index} unitName={role.role} />
                                </li>
                            );
                        })}
                        <li className="py-4">
                            <Button type="button" variant="link" size="sm" onClick={addRole} className="px-0">
                                <Plus className="size-3.5" aria-hidden="true" />
                                Add another role
                            </Button>
                        </li>
                    </ol>
                )}
            </section>
            <ChildLeadAndUnassigned />
            <InheritedAdminRows />
        </div>
    );
}
