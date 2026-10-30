'use client';

import { useCreateLocation } from '@/components/organizations/CreateLocation';
import { allowedChildVisibilities, type VisibilityCap } from '@/lib/organizations/child-rules';
import { OrgCalendarFields, OrgSettingsFields } from '@/components/organizations/OrgWizardFields';
import { ORG_CREATION_COPY } from '@/lib/organizations/creation';
import { readOrgDocsAction } from '@/app/actions/org-docs';
import { listOrgTemplateFoldersAction } from '@/app/actions/org-files';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Bell, Building2, Check, ChevronDown, FileText, Folder, Globe, ImageIcon, ImagePlus, Info, Link2, Lock, Users, Workflow, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/feedback';
import { Button } from '@/components/ui/button';
import { LifecycleEditor } from '@/components/workspaces/LifecycleEditor';
import { WorkspaceLinkEditorFields } from '@/components/workspaces/dashboard/WorkspaceSocialLinksCard';
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch';
import { CREATE_WORKSPACE_NOTIFICATION_ROWS } from '@/lib/notifications/workspace-policy';
import { socialLinkItemsFromStorage } from '@/lib/profile/normalization';
import {
    DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY,
    WORKSPACE_PUBLIC_TAB_LABELS,
    type WorkspacePublicTabId,
} from '@/lib/workspaces/settings-policies';
import { ALLOWED_WORKSPACE_IMAGE_MIME_TYPES, WORKSPACE_IMAGE_UPLOAD_MAX_BYTES } from '@/lib/upload/workspace-image-upload-client';
import { CreateWorkspaceInput } from '@/lib/validations/workspace';

type Phase4SettingsProps = {
    showValidationSummary?: boolean;
    linkComposerPending?: boolean;
    onLinkComposerPending?: (pending: boolean) => void;
    projectImage: File | null;
    onProjectImageChange: (file: File | null) => void;
};

// Same order and names as Project settings, so what is chosen here is where it lives later (spec §18).
// Icons match the Project settings rail for the same sections.
const SECTIONS: ReadonlyArray<{ id: string; eyebrow: string; label: string; description: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'picture', eyebrow: 'Workspace picture', label: 'Workspace picture', description: 'Image on cards and header', icon: ImageIcon },
    { id: 'access', eyebrow: 'Access and visibility', label: 'Access and visibility', description: 'Visibility and public tabs', icon: Globe },
    { id: 'links', eyebrow: 'Links', label: 'Links', description: 'External destinations', icon: Link2 },
    { id: 'documentation', eyebrow: 'Documentation', label: 'Documentation', description: 'Starter doc and editing', icon: FileText },
    { id: 'lifecycle', eyebrow: 'Stages and workflow', label: 'Stages and workflow', description: 'Journey stages', icon: Workflow },
    { id: 'permissions', eyebrow: 'Team permissions', label: 'Team permissions', description: 'Updates and uploads', icon: Users },
    { id: 'files', eyebrow: 'Files and storage', label: 'Files and storage', description: 'Source and upload rules', icon: Folder },
    { id: 'notifications', eyebrow: 'Notifications', label: 'Notifications', description: 'Team notification rules', icon: Bell },
] as const;
type SectionId = 'picture' | 'access' | 'links' | 'documentation' | 'lifecycle' | 'permissions' | 'files' | 'notifications';

const PUBLIC_TAB_ORDER: WorkspacePublicTabId[] = ['dashboard', 'readme', 'updates', 'files', 'sprints', 'tasks'];
const sectionAnchor = (id: SectionId) => `create-project-launch-${id}`;

function LaunchSection({ id, title, description, summary, collapsible, open, onToggle, children }: {
    id: SectionId;
    title: string;
    description?: string;
    summary: string;
    collapsible: boolean;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}) {
    const index = SECTIONS.findIndex((section) => section.id === id);
    const heading = (
        <>
            <p className="nb-micro text-primary">{String(index + 1).padStart(2, '0')} · {SECTIONS[index]?.eyebrow}</p>
            <h3 id={`${sectionAnchor(id)}-heading`} className="nb-card-title mt-1 text-foreground">{title}</h3>
            {description && (!collapsible || open) ? <p className="nb-compact mt-1 max-w-[65ch] text-muted-foreground">{description}</p> : null}
            {collapsible && !open ? <p className="nb-meta mt-1 truncate text-muted-foreground">{summary}</p> : null}
        </>
    );

    return (
        <section id={sectionAnchor(id)} data-launch-section={id} aria-labelledby={`${sectionAnchor(id)}-heading`} className="border-t border-border pt-6">
            {collapsible ? (
                // Phones: each section is one summary line until opened, so eight sections stay scannable.
                <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${sectionAnchor(id)}-body`} className="flex w-full min-w-0 items-start justify-between gap-3 text-left">
                    <span className="min-w-0">{heading}</span>
                    <ChevronDown className={`mt-5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
            ) : heading}
            <div id={`${sectionAnchor(id)}-body`} hidden={collapsible && !open} className="mt-5">{children}</div>
        </section>
    );
}

function SwitchRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
            <div className="min-w-0">
                <p className="nb-ui-label text-foreground">{label}</p>
                <p className="nb-compact mt-1 text-muted-foreground">{description}</p>
            </div>
            <SettingsSwitch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} className="mt-0.5" />
        </div>
    );
}

function ChoiceChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            className={`nb-touch-target inline-flex h-[var(--ui-control-height-sm)] items-center gap-1.5 rounded-[3px] border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-secondary text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground'}`}
        >
            {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
            {children}
        </button>
    );
}

export default function Phase4Settings({ showValidationSummary = false, linkComposerPending = false, onLinkComposerPending, projectImage, onProjectImageChange }: Phase4SettingsProps) {
    const { control, setValue, getFieldState, formState: { errors } } = useFormContext<CreateWorkspaceInput>();
    const isOrganization = Boolean(useWatch({ control, name: 'organization' }));
    const childOrg = useCreateLocation().org;
    // Report §19.7 and §23.6: the starter doc lists the org's templates first; files can start from a Template folder.
    const [orgTemplates, setOrgTemplates] = useState<Array<{ id: string; filename: string }>>([]);
    const [templateFolders, setTemplateFolders] = useState<Array<{ id: string; name: string }>>([]);
    const templateFolderId = useWatch({ control, name: 'org_template_folder_id' });
    useEffect(() => {
        setOrgTemplates([]);
        setTemplateFolders([]);
        if (!childOrg) return;
        let live = true;
        void Promise.all([readOrgDocsAction(childOrg.id), listOrgTemplateFoldersAction(childOrg.id)]).then(([docs, folders]) => {
            if (!live) return;
            setOrgTemplates(docs.success && docs.data ? docs.data.docs.filter((d) => d.template).map((d) => ({ id: d.id, filename: d.filename })) : []);
            setTemplateFolders(folders);
        });
        return () => { live = false; };
    }, [childOrg]);
    // Report §14.3 Phase 4: member permissions start from the org's values, unless already changed here.
    useEffect(() => {
        if (!childOrg) return;
        if (childOrg.memberUpdatesEnabled !== undefined && !getFieldState('member_updates_enabled').isDirty) setValue('member_updates_enabled', childOrg.memberUpdatesEnabled);
        if (childOrg.memberFileUploadDefault !== undefined && !getFieldState('member_file_upload_default').isDirty) setValue('member_file_upload_default', childOrg.memberFileUploadDefault);
        if (childOrg.followSprintsDefault !== undefined && !getFieldState('follow_org_sprints').isDirty) setValue('follow_org_sprints', childOrg.followSprintsDefault);
    }, [childOrg, getFieldState, setValue]);
    const followOrgSprints = useWatch({ control, name: 'follow_org_sprints' });
    // The type's member-updates default is applied in Phase 1 (applyOrgTypeDefaults); here only its doc name.
    const orgType = useWatch({ control, name: 'organization.org_type' });
    const orgStarterDoc = isOrganization ? ORG_CREATION_COPY[orgType ?? 'other'].starterDoc : null;
    // Orgs don't use manual Journey stages: their Journey is built from sprints (report §22.1).
    const sections = isOrganization ? SECTIONS.filter((s) => s.id !== 'lifecycle') : SECTIONS;
    const [
        visibilityValue, publicTabsValue, externalLinksValue, readme, docEditPolicy, lifecycleStagesValue,
        memberUpdatesEnabled, memberFileUploadDefault, notificationRowsValue,
        importSource, projectType,
    ] = useWatch({
        control,
        name: [
            'visibility', 'public_tab_visibility', 'external_links', 'readme', 'doc_edit_policy', 'lifecycle_stages',
            'member_updates_enabled', 'member_file_upload_default', 'notification_rows',
            'import_source', 'project_type',
        ],
    });
    const visibility = visibilityValue || 'public';
    const publicTabs = { ...DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY, ...(publicTabsValue || {}) };
    const externalLinks = socialLinkItemsFromStorage(externalLinksValue);
    const docMode = readme?.mode === 'skip' ? 'skip' : 'starter';
    const lifecycleStages = lifecycleStagesValue || [];
    const notificationRows = { roles_applications: true, work: true, updates_docs: true, ...(notificationRowsValue || {}) };
    const sourceType = importSource?.type || 'scratch';
    const sourceMetadata = (importSource?.metadata || {}) as Record<string, unknown>;

    const externalLinksError = (errors.external_links as { message?: string } | undefined)?.message;
    const validationMessages = [
        linkComposerPending ? { id: sectionAnchor('links'), message: 'Finish the workspace link' } : null,
        externalLinksError ? { id: sectionAnchor('links'), message: externalLinksError } : null,
    ].filter((item): item is { id: string; message: string } => Boolean(item));

    const [isPhone, setIsPhone] = useState(false);
    const [openSections, setOpenSections] = useState<Set<SectionId>>(() => new Set());
    useEffect(() => {
        const query = window.matchMedia('(max-width: 767px)');
        const sync = () => setIsPhone(query.matches);
        sync();
        query.addEventListener('change', sync);
        return () => query.removeEventListener('change', sync);
    }, []);
    // Unfinished link work must stay visible on phones too.
    const isOpen = (id: SectionId) => !isPhone || openSections.has(id) || (id === 'links' && validationMessages.length > 0);
    const toggleSection = (id: SectionId) => setOpenSections((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    useEffect(() => () => onLinkComposerPending?.(false), [onLinkComposerPending]);

    // The rail scrolls only the wizard body. scrollIntoView() would also scroll the app's
    // overflow-hidden main area and push the page header out of view.
    const rootRef = useRef<HTMLDivElement>(null);
    const [activeSection, setActiveSection] = useState<SectionId>('picture');
    const getScroller = useCallback(() => rootRef.current?.closest<HTMLElement>('[data-wizard-scroll]') ?? null, []);
    useEffect(() => {
        const scroller = getScroller();
        if (!scroller) return;
        let frame = 0;
        const sync = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const top = scroller.getBoundingClientRect().top;
                const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
                let current: SectionId = 'picture';
                for (const element of scroller.querySelectorAll<HTMLElement>('[data-launch-section]')) {
                    if (element.getBoundingClientRect().top - top <= 96) current = element.dataset.launchSection as SectionId;
                }
                // The last sections can't reach the top of a short page; at the bottom, the last one is current.
                setActiveSection(atBottom ? 'notifications' : current);
            });
        };
        sync();
        scroller.addEventListener('scroll', sync, { passive: true });
        return () => { cancelAnimationFrame(frame); scroller.removeEventListener('scroll', sync); };
    }, [getScroller]);
    const goToSection = (id: SectionId) => {
        const scroller = getScroller();
        const target = document.getElementById(sectionAnchor(id));
        if (!scroller || !target) return;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scroller.scrollTo({
            top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16,
            behavior: reduceMotion ? 'auto' : 'smooth',
        });
        setActiveSection(id);
    };

    const imageInputRef = useRef<HTMLInputElement>(null);
    const imagePreviewUrl = useMemo(() => (projectImage ? URL.createObjectURL(projectImage) : null), [projectImage]);
    useEffect(() => () => { if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl); }, [imagePreviewUrl]);
    const chooseImage = (file: File | undefined) => {
        if (!file) return;
        if (!ALLOWED_WORKSPACE_IMAGE_MIME_TYPES.has(file.type)) {
            toast.error('Choose a PNG, JPG, WebP, or GIF image');
            return;
        }
        if (file.size > WORKSPACE_IMAGE_UPLOAD_MAX_BYTES) {
            toast.error('Choose an image under 2 MB');
            return;
        }
        onProjectImageChange(file);
    };

    const set = <K extends Parameters<typeof setValue>[0]>(name: K, value: Parameters<typeof setValue<K>>[1]) =>
        setValue(name, value, { shouldDirty: true, shouldValidate: true });

    const publicTabCount = PUBLIC_TAB_ORDER.filter((tab) => publicTabs[tab]).length;
    const notificationsOn = CREATE_WORKSPACE_NOTIFICATION_ROWS.filter((row) => notificationRows[row.id]).length;
    const sourceSummary = sourceType === 'github'
        ? `Imported from ${importSource?.repoUrl?.replace('https://github.com/', '') || 'GitHub'} after creation`
        : sourceType === 'upload'
            ? `${Number(sourceMetadata.fileCount || 0)} files from ${String(sourceMetadata.folderName || 'your folder')} upload after creation`
            : 'Starts empty. Add files from the Files tab after creation';
    const sectionProps = (id: SectionId) => ({ id, collapsible: isPhone, open: isOpen(id), onToggle: () => toggleSection(id) });

    return (
        <div ref={rootRef} className="min-w-0 w-full lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
            {/* Wide screens: the same section rail as Project settings (card, icon, label, description, active state). */}
            <aside className="sticky top-0 hidden self-start rounded-lg border border-border bg-card p-2 xl:block lg:block">
                <div className="px-3 pb-3 pt-2">
                    <p className="nb-micro">Starting settings</p>
                    <p className="nb-compact mt-1 text-muted-foreground">Jump to any section. All start at the Settings defaults.</p>
                </div>
                <nav aria-label="Starting settings sections" className="mt-1 space-y-1">
                    {sections.map((section) => {
                        const Icon = section.icon;
                        const active = activeSection === section.id;
                        return (
                            <button
                                key={section.id}
                                type="button"
                                aria-current={active ? 'location' : undefined}
                                onClick={() => goToSection(section.id as SectionId)}
                                className={cn(
                                    'group flex min-h-[44px] w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)]',
                                    active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                                )}
                            >
                                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0 transition-colors', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                                <span className="min-w-0 flex-1">
                                    <span className="nb-ui-label block truncate text-[13px] leading-tight">{section.label}</span>
                                    <span className={cn('mt-0.5 block truncate text-[11px] leading-snug', active ? 'text-foreground/80' : 'text-muted-foreground/70')}>{section.description}</span>
                                </span>
                            </button>
                        );
                    })}
                </nav>
            </aside>

            <div className="min-w-0 w-full space-y-8 pb-6">
                <div className="max-w-[65ch]">
                    <p className="nb-micro text-primary">Phase 4 · {isOrganization ? 'setup' : 'settings'}</p>
                    <h2 className="nb-section-title mt-1 text-foreground">{isOrganization ? 'Setup' : 'Choose how the workspace starts'}</h2>
                    <p className="nb-compact mt-1.5 text-muted-foreground">{isOrganization ? 'Who can see it and how it runs. Everything here is in Settings later.' : 'Every choice has a sensible default and can be changed later in Workspace settings.'}</p>
                </div>
                {isOrganization ? (
                    <>
                        <section aria-labelledby="create-org-calendar" className="border-t border-border pt-6">
                            <h3 id="create-org-calendar" className="nb-card-title mb-4 text-foreground">Calendar</h3>
                            <OrgCalendarFields />
                        </section>
                        <section aria-labelledby="create-org-inside" className="border-t border-border pt-6">
                            <h3 id="create-org-inside" className="nb-card-title mb-4 text-foreground">Workspaces inside and work</h3>
                            <OrgSettingsFields />
                        </section>
                    </>
                ) : null}

                {showValidationSummary && validationMessages.length > 0 ? (
                    <div role="alert" aria-live="assertive" className="border-l-2 border-destructive bg-[var(--status-danger-soft)] px-4 py-3 text-[13px] leading-[1.5] text-foreground">
                        <p className="font-semibold">Finish the workspace links before continuing</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                            {validationMessages.map((err) => (
                                <li key={err.message}>
                                    <a
                                        href={`#${err.id}`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            const el = document.getElementById(err.id);
                                            el?.focus();
                                            const scroller = getScroller();
                                            if (scroller && el) {
                                                scroller.scrollTo({
                                                    top: scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16,
                                                    behavior: 'smooth',
                                                });
                                            }
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

                <LaunchSection {...sectionProps('picture')} title="Workspace picture" description="Shown on workspace cards, search, and the workspace header." summary={projectImage ? 'Picture added' : 'Initials until you add a picture'}>
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-input bg-muted/30 text-muted-foreground">
                            {imagePreviewUrl ? <img src={imagePreviewUrl} alt="Selected workspace picture" className="size-full object-cover" /> : <ImagePlus className="size-5" aria-hidden="true" />}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="outline" onClick={() => imageInputRef.current?.click()}>{projectImage ? 'Replace image' : 'Upload image'}</Button>
                            {projectImage ? <Button type="button" variant="ghost" onClick={() => onProjectImageChange(null)}><X aria-hidden="true" /> Remove</Button> : null}
                        </div>
                        <p className="nb-compact basis-full text-muted-foreground">PNG, JPG, WebP, or GIF up to 2 MB. Square works best; it is center-cropped. Uses initials if skipped.</p>
                        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ''; }} />
                    </div>
                </LaunchSection>

                <LaunchSection {...sectionProps('access')} title="Choose workspace visibility" description="Controls who can find the workspace now, and which tabs outsiders see." summary={visibility === 'private' ? 'Private · members only' : visibility === 'org' ? `Organization only · members of ${childOrg?.title ?? 'the organization'}` : `Public · ${publicTabCount} public ${publicTabCount === 1 ? 'tab' : 'tabs'}`}>
                    <fieldset className="border-y border-border" aria-describedby="create-project-visibility-help">
                        <legend className="sr-only">Workspace visibility</legend>
                        {(childOrg
                            ? [
                                { id: 'public' as const, label: 'Public', icon: Globe, description: 'Anyone can discover the workspace and view its public tabs.' },
                                { id: 'org' as const, label: 'Organization', icon: Building2, description: `Every member of ${childOrg.title} can see it.` },
                                { id: 'private' as const, label: 'Private', icon: Lock, description: `The team and ${childOrg.title} admins.` },
                            ]
                            : [
                                { id: 'public' as const, label: 'Public', icon: Globe, description: 'Anyone can discover the workspace and view its public tabs.' },
                                { id: 'private' as const, label: 'Private', icon: Lock, description: 'Only members can see this workspace until you make it public.' },
                            ]).map((option) => {
                            const Icon = option.icon;
                            const isSelected = visibility === option.id;
                            // Choices above the org's cap show as locked rows (report §14.3).
                            const locked = Boolean(childOrg && !allowedChildVisibilities(childOrg.visibilityCap as VisibilityCap, childOrg.orgPublic).includes(option.id));
                            if (locked) {
                                return (
                                    <div key={option.id} className="flex items-start gap-3 border-b border-border px-4 py-4 text-muted-foreground last:border-b-0" aria-disabled="true">
                                        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                                        <span className="min-w-0"><span className="nb-ui-label block">{option.label}</span><span className="nb-compact mt-1 block">Set by {childOrg!.title}</span></span>
                                    </div>
                                );
                            }
                            return (
                                <label key={option.id} className={`flex cursor-pointer items-start gap-3 border-b border-border px-4 py-4 last:border-b-0 transition-[background-color,border-color] duration-[130ms] focus-within:bg-muted/30 ${isSelected ? 'bg-secondary/60' : 'hover:bg-muted/30'}`}>
                                    <input type="radio" name="project-visibility" value={option.id} checked={isSelected} onChange={() => set('visibility', option.id)} className="sr-only" />
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
                    {visibility === 'public' || visibility === 'org' ? (
                        <div className="mt-4">
                            <p className="nb-ui-label text-foreground">{visibility === 'org' ? `Tabs for ${childOrg?.title ?? 'organization'} members outside the team` : 'Public tabs'}</p>
                            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Public tabs">
                                {PUBLIC_TAB_ORDER.map((tab) => (
                                    <ChoiceChip key={tab} selected={publicTabs[tab]} onClick={() => set('public_tab_visibility', { ...publicTabs, [tab]: !publicTabs[tab] })}>
                                        {WORKSPACE_PUBLIC_TAB_LABELS[tab]}
                                    </ChoiceChip>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    <p id="create-project-visibility-help" className="mt-3 max-w-[65ch] text-[13px] leading-[1.5] text-muted-foreground">
                        <span className="font-medium text-foreground">Visible when created: </span>
                        {visibility === 'public' || visibility === 'org'
                            ? PUBLIC_TAB_ORDER.filter((tab) => publicTabs[tab]).map((tab) => WORKSPACE_PUBLIC_TAB_LABELS[tab]).join(' · ') || 'Workspace title and card only'
                            : 'Members only. Tab choices apply once you make the workspace public.'}
                    </p>
                </LaunchSection>

                <LaunchSection {...sectionProps('links')} title="Workspace links" description="Website, repository, demo, or community. Shown beside the workspace title and across public surfaces." summary={externalLinks.length === 0 ? 'No links yet' : `${externalLinks.length} ${externalLinks.length === 1 ? 'link' : 'links'}`}>
                    <WorkspaceLinkEditorFields
                        links={externalLinks}
                        savedLinks={[]}
                        onChange={(links) => set('external_links', links)}
                        onPendingChange={onLinkComposerPending}
                        importSource={importSource}
                        projectType={projectType}
                        commitContext="project-create"
                    />
                    {externalLinksError ? <p role="alert" className="mt-2 text-[13px] leading-[1.5] text-destructive">{externalLinksError}</p> : null}
                </LaunchSection>

                <LaunchSection {...sectionProps('documentation')} title="Starter doc" description="The workspace Doc tab: setup notes, guidance, and how to contribute." summary={docMode === 'skip' ? 'No documents yet' : `${orgTemplates.find((t) => t.id === readme?.orgTemplateDocId)?.filename.replace(/\.md$/i, '') ?? (orgStarterDoc ? `${orgStarterDoc} template` : 'Starter template')} · ${readme?.publishOnCreate ? 'published' : 'draft'}`}>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Starter doc">
                        {orgTemplates.map((t) => (
                            <ChoiceChip key={t.id} selected={docMode === 'starter' && readme?.orgTemplateDocId === t.id} onClick={() => set('readme', { ...readme, mode: 'starter', orgTemplateDocId: t.id } as CreateWorkspaceInput['readme'])}>
                                {childOrg?.title}: {t.filename.replace(/\.md$/i, '')}
                            </ChoiceChip>
                        ))}
                        <ChoiceChip selected={docMode === 'starter' && !readme?.orgTemplateDocId} onClick={() => set('readme', { ...readme, mode: 'starter', orgTemplateDocId: null } as CreateWorkspaceInput['readme'])}>{orgStarterDoc ? `${orgStarterDoc} template` : 'Starter template'}</ChoiceChip>
                        <ChoiceChip selected={docMode === 'skip'} onClick={() => set('readme', { ...readme, mode: 'skip', publishOnCreate: false } as CreateWorkspaceInput['readme'])}>No documents yet</ChoiceChip>
                    </div>
                    {sourceType !== 'scratch' ? (
                        <p className="nb-compact mt-3 flex items-start gap-2 text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Your repository README can be linked from the Doc tab once the import finishes.</p>
                    ) : null}
                    {docMode === 'starter' ? (
                        <div className="mt-4 border-y border-border">
                            <SwitchRow label="Publish the document when the workspace is created" description="Off: only the owner and admins can see it." checked={Boolean(readme?.publishOnCreate)} onCheckedChange={(checked) => set('readme', { ...readme, publishOnCreate: checked } as CreateWorkspaceInput['readme'])} />
                            <SwitchRow label="Members can edit the doc" description="Off: only the owner and admins can edit." checked={docEditPolicy === 'members'} onCheckedChange={(checked) => set('doc_edit_policy', checked ? 'members' : 'leaders')} />
                        </div>
                    ) : null}
                </LaunchSection>

                {isOrganization ? null : <LaunchSection {...sectionProps('lifecycle')} title="Journey stages" description="Stages are suggested from the category. Rename, reorder, or add them to match how the work will progress." summary={lifecycleStages.length ? `${lifecycleStages.length} stages` : 'No stages yet'}>
                    <LifecycleEditor
                        stages={lifecycleStages}
                        onChange={(stages) => set('lifecycle_stages', stages)}
                        showCurrentStage={false}
                    />
                </LaunchSection>}

                <LaunchSection {...sectionProps('permissions')} title="What members can do" description="The owner and admins can always do both. These apply to members who join later." summary={`Updates: ${memberUpdatesEnabled !== false ? 'members' : 'owner and admins only'} · Uploads: ${memberFileUploadDefault !== false ? 'members' : 'owner and admins only'}`}>
                    <div className="border-y border-border">
                        <SwitchRow label="Members can post updates" description="Progress posts on the Updates tab." checked={memberUpdatesEnabled !== false} onCheckedChange={(checked) => set('member_updates_enabled', checked)} />
                        <SwitchRow label="New members can upload files" description="The starting upload permission for each member; adjustable per member later." checked={memberFileUploadDefault !== false} onCheckedChange={(checked) => set('member_file_upload_default', checked)} />
                        {childOrg ? <SwitchRow label={`Follow ${childOrg.title}'s sprints`} description="New sprints link to the organization’s sprint holding their dates and stay inside it." checked={Boolean(followOrgSprints)} onCheckedChange={(checked) => set('follow_org_sprints', checked)} /> : null}
                    </div>
                </LaunchSection>

                <LaunchSection {...sectionProps('files')} title="Workspace files" description="Where the workspace’s files come from and who can add more." summary={sourceSummary}>
                    <div className="border-y border-border">
                        <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
                            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <div className="min-w-0">
                                <p className="nb-ui-label text-foreground">Source</p>
                                <p className="nb-compact mt-1 text-muted-foreground">{sourceSummary}. Change the source in step 1.</p>
                            </div>
                        </div>
                        {childOrg && templateFolders.length > 0 ? (
                            <div className="border-b border-border px-4 py-3.5">
                                <label htmlFor="org-template-folder" className="nb-ui-label text-foreground">From a {childOrg.title} template</label>
                                <p className="nb-compact mt-1 text-muted-foreground">Copies the folder into the new workspace. The copies are yours to change.</p>
                                <select id="org-template-folder" value={templateFolderId ?? ''} onChange={(e) => set('org_template_folder_id', e.target.value || null)}
                                    className="mt-2 h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm">
                                    <option value="">None</option>
                                    {templateFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                            </div>
                        ) : null}
                        <div className="flex items-start gap-3 px-4 py-3.5">
                            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <div className="min-w-0">
                                <p className="nb-ui-label text-foreground">Uploads</p>
                                <p className="nb-compact mt-1 text-muted-foreground">The owner and admins can always upload. New members {memberFileUploadDefault !== false ? 'can upload' : 'can’t upload'}, set under Team permissions.</p>
                            </div>
                        </div>
                    </div>
                </LaunchSection>

                <LaunchSection {...sectionProps('notifications')} title="What the team is told about" description="Workspace-wide notification rules. Each member can still tune their own." summary={`${notificationsOn} of ${CREATE_WORKSPACE_NOTIFICATION_ROWS.length} on`}>
                    <div className="border-y border-border">
                        {CREATE_WORKSPACE_NOTIFICATION_ROWS.map((row) => (
                            <SwitchRow key={row.id} label={row.label} description={row.description} checked={notificationRows[row.id]} onCheckedChange={(checked) => set('notification_rows', { ...notificationRows, [row.id]: checked })} />
                        ))}
                    </div>
                    <p className="nb-compact mt-3 text-muted-foreground">Membership and security alerts always stay on.</p>
                </LaunchSection>

                <aside className="border-l-2 border-border pl-4 text-[13px] leading-[1.5] text-muted-foreground">
                    After creation, in workspace settings: members and invitations, privacy and workspace management.
                </aside>
            </div>
        </div>
    );
}
