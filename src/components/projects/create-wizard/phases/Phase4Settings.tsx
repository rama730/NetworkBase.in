'use client';

import { useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { Check, Globe, Lock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectLinkEditorFields } from '@/components/projects/dashboard/ProjectSocialLinksCard';
import { socialLinkItemsFromStorage } from '@/lib/profile/normalization';
import { CreateProjectInput } from '@/lib/validations/project';

type Phase4SettingsProps = {
    showValidationSummary?: boolean;
    linkComposerPending?: boolean;
    onLinkComposerPending?: (pending: boolean) => void;
    onEditRoles?: () => void;
};

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description: string; id: string }) {
    return (
        <div className="max-w-[65ch]">
            <p className="nb-micro text-primary">{eyebrow}</p>
            <h3 id={id} className="nb-card-title mt-1 text-foreground">{title}</h3>
            <p className="nb-compact mt-1 text-muted-foreground">{description}</p>
        </div>
    );
}

export default function Phase4Settings({ showValidationSummary = false, linkComposerPending = false, onLinkComposerPending, onEditRoles }: Phase4SettingsProps) {
    const { setValue, watch, formState: { errors } } = useFormContext<CreateProjectInput>();
    const visibility = watch('visibility') || 'public';
    const openRoles = watch('roles') || [];
    const externalLinks = socialLinkItemsFromStorage(watch('external_links'));
    const openRoleCount = openRoles.filter((role) => role.role.trim().length > 0).length;
    const openPositionCount = openRoles.reduce((total, role) => total + role.count, 0);
    const externalLinksError = (errors.external_links as { message?: string } | undefined)?.message;
    const validationMessages = [
        linkComposerPending ? 'Finish adding the project link or clear the URL before continuing.' : null,
        externalLinksError,
    ].filter((message): message is string => Boolean(message));

    useEffect(() => () => onLinkComposerPending?.(false), [onLinkComposerPending]);

    const selectVisibility = (nextVisibility: 'public' | 'private') => {
        setValue('visibility', nextVisibility, { shouldDirty: true, shouldValidate: true });
    };

    return (
        <div className="min-w-0 w-full space-y-8 pb-6">
            <div className="max-w-[65ch]">
                <p className="nb-micro text-primary">Phase 4 · settings</p>
                <h2 className="nb-section-title mt-1 text-foreground">Set the project’s launch settings</h2>
                <p className="nb-compact mt-1.5 text-muted-foreground">Choose who can find the project, confirm its collaboration state, and add the destinations people need.</p>
            </div>

            {showValidationSummary && validationMessages.length > 0 ? (
                <div role="alert" aria-live="assertive" className="border-l-2 border-destructive bg-[var(--status-danger-soft)] px-4 py-3 text-[13px] leading-[1.5] text-foreground">
                    <p className="font-semibold">Finish the project links before continuing</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {validationMessages.map((message) => <li key={message}>{message}</li>)}
                    </ul>
                </div>
            ) : null}

            <section aria-labelledby="project-access-heading" className="border-t border-border pt-6">
                <SectionHeading
                    id="project-access-heading"
                    eyebrow="Access"
                    title="Choose project visibility"
                    description="This controls whether the project can be discovered now. You can refine public tabs after the project is created."
                />

                <fieldset className="mt-5 border-y border-border" aria-describedby="create-project-visibility-help">
                    <legend className="sr-only">Project visibility</legend>
                    {([
                        { id: 'public' as const, label: 'Public', icon: Globe, description: 'Anyone can discover the project and view its public surfaces.' },
                        { id: 'private' as const, label: 'Private', icon: Lock, description: 'Only collaborators can access the project until you make it public.' },
                    ]).map((option) => {
                        const Icon = option.icon;
                        const isSelected = visibility === option.id;
                        return (
                            <label key={option.id} className={`flex cursor-pointer items-start gap-3 border-b border-border px-4 py-4 last:border-b-0 transition-[background-color,border-color] duration-[130ms] focus-within:ring-2 focus-within:ring-ring/30 ${isSelected ? 'bg-secondary/60' : 'hover:bg-muted/30'}`}>
                                <input type="radio" name="project-visibility" value={option.id} checked={isSelected} onChange={() => selectVisibility(option.id)} className="sr-only" />
                                <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[3px] border ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-transparent'}`} aria-hidden="true">
                                    <Check className="size-3" strokeWidth={2} />
                                </span>
                                <Icon className={`mt-0.5 size-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} strokeWidth={1.75} aria-hidden="true" />
                                <span className="min-w-0">
                                    <span className="nb-ui-label block text-foreground">{option.label}</span>
                                    <span className="nb-compact mt-1 block max-w-[58ch] text-muted-foreground">{option.description}</span>
                                </span>
                            </label>
                        );
                    })}
                </fieldset>
                <p id="create-project-visibility-help" className="mt-3 max-w-[65ch] text-[13px] leading-[1.5] text-muted-foreground">
                    <span className="font-medium text-foreground">Visible at launch: </span>
                    {visibility === 'public'
                        ? 'Dashboard · Doc · Updates · Files. You can change these surfaces later in Project settings.'
                        : 'Collaborators only. Public-surface choices take effect only after you make the project public.'}
                </p>
            </section>

            <section aria-labelledby="project-collaboration-heading" className="border-t border-border pt-6">
                <div className="flex items-start justify-between gap-4">
                    <SectionHeading
                        id="project-collaboration-heading"
                        eyebrow="Collaboration"
                        title="Confirm the initial availability"
                        description="This reflects the roles you set in the previous phase."
                    />
                    {onEditRoles ? <Button type="button" variant="link" size="sm" className="-mt-1 shrink-0" onClick={onEditRoles}>Edit roles</Button> : null}
                </div>
                <div className="mt-5 flex items-start gap-3 border-y border-border py-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[3px] border border-border bg-secondary text-primary" aria-hidden="true"><Users className="size-4" strokeWidth={1.75} /></span>
                    <div className="min-w-0">
                        <p className="nb-ui-label text-foreground">{openRoleCount > 0 ? 'Open to collaborators' : 'No openings planned'}</p>
                        <p className="nb-compact mt-1 max-w-[60ch] text-muted-foreground">
                            {openRoleCount > 0
                                ? `${openRoleCount} ${openRoleCount === 1 ? 'role' : 'roles'} · ${openPositionCount} ${openPositionCount === 1 ? 'opening' : 'openings'} will be visible to potential contributors.`
                                : 'The project will be created without recruitment listings. You can add roles later from Project settings.'}
                        </p>
                    </div>
                </div>
            </section>

            <section aria-labelledby="project-links-heading" className="border-t border-border pt-6">
                <SectionHeading
                    id="project-links-heading"
                    eyebrow="Destinations"
                    title="Project links"
                    description="External project destinations and connected repositories displayed beside the project title and across public surfaces."
                />

                <div className="mt-5">
                    <ProjectLinkEditorFields
                        links={externalLinks}
                        savedLinks={[]}
                        onChange={(links) => setValue('external_links', links, { shouldDirty: true, shouldValidate: true })}
                        onPendingChange={onLinkComposerPending}
                        importSource={watch('import_source')}
                        projectType={watch('project_type')}
                        commitContext="project-create"
                    />
                </div>
                {externalLinksError ? <p role="alert" className="mt-2 text-[13px] leading-[1.5] text-destructive">{externalLinksError}</p> : null}
            </section>

            <p aria-live="polite" className="border-t border-border pt-4 text-[13px] leading-[1.5] text-muted-foreground">
                <span className="font-medium text-foreground">Ready to review: </span>
                {visibility === 'private' ? 'Private project' : 'Public project'} · {openRoleCount === 0 ? 'no openings' : `${openRoleCount} ${openRoleCount === 1 ? 'role' : 'roles'} · ${openPositionCount} ${openPositionCount === 1 ? 'opening' : 'openings'}`} · {externalLinks.length === 0 ? 'no public links' : `${externalLinks.length} ${externalLinks.length === 1 ? 'public link' : 'public links'}`}
            </p>

            <aside className="border-l-2 border-border pl-4 text-[13px] leading-[1.5] text-muted-foreground">
                Roles, notifications, public-tab controls, documents, files, and privacy policies remain available after creation in Project settings.
            </aside>
        </div>
    );
}
