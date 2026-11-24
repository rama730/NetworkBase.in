'use client';

import { useCreateLocation } from '@/components/organizations/CreateLocation';
import { PhaseHead } from '../PhaseHead';
import { allowedChildVisibilities, capChildVisibility, type VisibilityCap } from '@/lib/organizations/child-rules';
import { OrgCalendarFields, OrgSettingsFields } from '@/components/organizations/OrgWizardFields';
import { ORG_CREATION_COPY, orgTypeDefaults } from '@/lib/organizations/creation';
import { getLifecycleStagesForWorkspaceType } from '@/lib/workspaces/lifecycle-templates';
import { readOrgDocsAction } from '@/app/actions/org-docs';
import { listOrgTemplateFoldersAction } from '@/app/actions/org-files';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Building2, Check, Globe, ImagePlus, Info, Lock, Search, X } from 'lucide-react';
import { WizardWorkflowsField } from '@/components/workspaces/workflows/WizardWorkflowsField';
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
    /** Files → "Change in Start". */
    goToPhase?: (phase: 1) => void;
};

// Same order as Project settings, so what is chosen here is where it lives later (spec §18). v6.7: each heading says
// what you choose; the short label names it in the docked list.
type SectionId = 'calendar' | 'inside' | 'picture' | 'access' | 'links' | 'documentation' | 'lifecycle' | 'permissions' | 'files' | 'notifications';
type SectionDef = { id: SectionId; label: string; title: string };
const SECTIONS: ReadonlyArray<SectionDef> = [
    { id: 'picture', label: 'Picture', title: 'How it looks on cards' },
    { id: 'access', label: 'Visibility', title: 'Who can see it' },
    { id: 'links', label: 'Links', title: 'Where people find more' },
    { id: 'documentation', label: 'Starter doc', title: 'What it starts with' },
    { id: 'lifecycle', label: 'Stages', title: 'Journey stages' },
    { id: 'permissions', label: 'Permissions', title: 'What members can do' },
    { id: 'files', label: 'Files', title: 'Where files come from' },
    { id: 'notifications', label: 'Notifications', title: 'What the team is told' },
];
// An organization's own sections lead the step (org design plan CR2).
const ORG_SECTIONS: ReadonlyArray<SectionDef> = [
    { id: 'calendar', label: 'Calendar', title: 'Term and first sprints' },
    { id: 'inside', label: 'Workspaces inside', title: 'How teams work inside it' },
];
const pad = (n: number) => String(n).padStart(2, '0');

const PUBLIC_TAB_ORDER: WorkspacePublicTabId[] = ['dashboard', 'readme', 'updates', 'files', 'sprints', 'tasks'];
const sectionAnchor = (id: SectionId) => `create-project-launch-${id}`;

/** One section as a Settings frame (v6.3): label, a serif heading that says what you choose, and, once changed,
 *  a Changed tag and "Back to default". */
function LaunchSection({ id, label, title, lead, changed, onReset, children }: {
    id: SectionId;
    label: string;
    title: string;
    lead?: string;
    changed: boolean;
    onReset: () => void;
    children: ReactNode;
}) {
    return (
        <section id={sectionAnchor(id)} data-launch-section={id} aria-labelledby={`${sectionAnchor(id)}-heading`} className="nbs-frame">
            <div className="nbs-fhead">
                <p className="nbs-eyebrow"><b>{label}</b>{changed ? <span className="nbs-tag hot nb-enter-chip">Changed</span> : null}</p>
                <h2 id={`${sectionAnchor(id)}-heading`}>{title}</h2>
                {lead ? <p>{lead}</p> : null}
                {changed ? <button type="button" className="nb-link nb-sreset justify-self-start text-[13px]" onClick={onReset}>Back to default</button> : null}
            </div>
            <div className="nb-sbody">{children}</div>
        </section>
    );
}

function SwitchRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
    return (
        <div className="nbs-row">
            <div className="min-w-0">
                <p className="t">{label}</p>
                <p className="d">{description}</p>
            </div>
            <SettingsSwitch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
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

export default function Phase4Settings({ showValidationSummary = false, linkComposerPending = false, onLinkComposerPending, projectImage, onProjectImageChange, goToPhase }: Phase4SettingsProps) {
    const { control, setValue, getFieldState, formState: { errors } } = useFormContext<CreateWorkspaceInput>();
    const isOrganization = Boolean(useWatch({ control, name: 'organization' }));
    // One noun for this step's copy (org design plan CR1): an organization's creator never reads "workspace".
    const noun = isOrganization ? 'organization' : 'workspace';
    const Noun = isOrganization ? 'Organization' : 'Workspace';
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
    const sections = useMemo(() => (isOrganization ? [...ORG_SECTIONS, ...SECTIONS.filter((s) => s.id !== 'lifecycle')] : SECTIONS), [isOrganization]);
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
        linkComposerPending ? { id: sectionAnchor('links'), message: `Finish the ${noun} link` } : null,
        externalLinksError ? { id: sectionAnchor('links'), message: externalLinksError } : null,
    ].filter((item): item is { id: string; message: string } => Boolean(item));

    useEffect(() => () => onLinkComposerPending?.(false), [onLinkComposerPending]);

    // The rail scrolls only the wizard body. scrollIntoView() would also scroll the app's
    // overflow-hidden main area and push the page header out of view.
    const rootRef = useRef<HTMLDivElement>(null);
    const [activeSection, setActiveSection] = useState<SectionId>(isOrganization ? 'calendar' : 'picture');
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
                let current: SectionId = sections[0]!.id;
                for (const element of scroller.querySelectorAll<HTMLElement>('[data-launch-section]')) {
                    if (element.getBoundingClientRect().top - top <= 96) current = element.dataset.launchSection as SectionId;
                }
                // The last sections can't reach the top of a short page; at the bottom, the last one is current.
                setActiveSection(atBottom ? sections[sections.length - 1]!.id : current);
            });
        };
        sync();
        scroller.addEventListener('scroll', sync, { passive: true });
        return () => { cancelAnimationFrame(frame); scroller.removeEventListener('scroll', sync); };
    }, [getScroller, sections]);
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

    // What each section starts at (v6.7), so a section can say Changed and go Back to default.
    const orgDefaults = isOrganization ? orgTypeDefaults(orgType ?? 'other') : null;
    const defaults = {
        visibility: orgDefaults?.visibility ?? (childOrg ? capChildVisibility('org', childOrg.visibilityCap as VisibilityCap, childOrg.orgPublic) : 'public'),
        memberUpdates: orgDefaults?.memberUpdates ?? childOrg?.memberUpdatesEnabled ?? true,
        memberUploads: childOrg?.memberFileUploadDefault ?? true,
        followSprints: Boolean(childOrg?.followSprintsDefault),
        stages: projectType ? getLifecycleStagesForWorkspaceType(projectType) : [],
    };
    const sameTabs = PUBLIC_TAB_ORDER.every((tab) => publicTabs[tab] === DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY[tab]);
    const reset = { shouldDirty: true, shouldValidate: true } as const;
    const sectionState: Record<SectionId, { changed: boolean; state: string; reset: () => void }> = {
        calendar: { changed: false, state: 'Optional', reset: () => undefined },
        inside: { changed: false, state: 'Default', reset: () => undefined },
        picture: { changed: Boolean(projectImage), state: projectImage ? 'Added' : 'None', reset: () => onProjectImageChange(null) },
        access: {
            changed: visibility !== defaults.visibility || !sameTabs,
            state: visibility === 'private' ? 'Private' : visibility === 'org' ? 'Members' : 'Public',
            reset: () => { setValue('visibility', defaults.visibility as CreateWorkspaceInput['visibility'], reset); setValue('public_tab_visibility', { ...DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY }, reset); },
        },
        links: { changed: externalLinks.length > 0, state: externalLinks.length ? pad(externalLinks.length) : 'None', reset: () => setValue('external_links', [], reset) },
        documentation: {
            changed: docMode === 'skip' || Boolean(readme?.publishOnCreate) || docEditPolicy === 'members' || Boolean(readme?.orgTemplateDocId),
            state: docMode === 'skip' ? 'None' : readme?.orgTemplateDocId ? 'Org doc' : 'Template',
            reset: () => { setValue('readme', { ...readme, mode: 'starter', publishOnCreate: false, orgTemplateDocId: null } as CreateWorkspaceInput['readme'], reset); setValue('doc_edit_policy', 'leaders', reset); },
        },
        lifecycle: {
            changed: Boolean(projectType) && lifecycleStages.join('\u0000') !== defaults.stages.join('\u0000'),
            state: pad(lifecycleStages.length),
            reset: () => setValue('lifecycle_stages', defaults.stages, reset),
        },
        permissions: {
            changed: (memberUpdatesEnabled !== false) !== defaults.memberUpdates || (memberFileUploadDefault !== false) !== defaults.memberUploads || (Boolean(childOrg) && Boolean(followOrgSprints) !== defaults.followSprints),
            state: '',
            reset: () => { setValue('member_updates_enabled', defaults.memberUpdates, reset); setValue('member_file_upload_default', defaults.memberUploads, reset); if (childOrg) setValue('follow_org_sprints', defaults.followSprints, reset); },
        },
        files: { changed: Boolean(templateFolderId), state: sourceType === 'github' ? 'GitHub' : sourceType === 'upload' ? 'Upload' : 'Empty', reset: () => setValue('org_template_folder_id', null, reset) },
        notifications: {
            changed: notificationsOn !== CREATE_WORKSPACE_NOTIFICATION_ROWS.length,
            state: `${notificationsOn} of ${CREATE_WORKSPACE_NOTIFICATION_ROWS.length}`,
            reset: () => setValue('notification_rows', { roles_applications: true, work: true, updates_docs: true }, reset),
        },
    };
    sectionState.permissions.state = sectionState.permissions.changed ? 'Changed' : 'Default';
    const changedCount = sections.filter((section) => sectionState[section.id].changed).length;
    const resetSection = (id: SectionId) => sectionState[id].reset();
    const resetAllChanged = () => sections.forEach((section) => { if (sectionState[section.id].changed) resetSection(section.id); });
    const sectionProps = (id: SectionId) => {
        const section = sections.find((item) => item.id === id)!;
        return { id, label: section.label, title: section.title, changed: sectionState[id].changed, onReset: () => resetSection(id) };
    };

    // The docked list (v6.3): Find filters it; one highlight slides to the current row.
    const [find, setFind] = useState('');
    const query = find.trim().toLowerCase();
    const shownSections = sections.filter((section) => !query || `${section.label} ${section.title}`.toLowerCase().includes(query));
    const listRef = useRef<HTMLDivElement>(null);
    const [highlight, setHighlight] = useState<{ y: number; h: number } | null>(null);
    useLayoutEffect(() => {
        const list = listRef.current;
        const row = list?.querySelector<HTMLElement>('.nbs-nl[aria-current="location"]');
        setHighlight(row ? { y: row.offsetTop, h: row.offsetHeight } : null);
        // Phones: the strip scrolls sideways; keep the current section in view.
        if (list && row && list.scrollWidth > list.clientWidth && (row.offsetLeft < list.scrollLeft || row.offsetLeft + row.offsetWidth > list.scrollLeft + list.clientWidth)) list.scrollLeft = row.offsetLeft - 16;
    }, [activeSection, query, sections.length]);
    // The dock is as tall as the visible step (the scroller), so it reads as a column pinned to the left edge.
    useEffect(() => {
        const scroller = getScroller();
        const root = rootRef.current;
        if (!scroller || !root) return;
        const size = () => root.style.setProperty('--nb-dock-h', `${scroller.clientHeight}px`);
        size();
        const observer = new ResizeObserver(size);
        observer.observe(scroller);
        return () => observer.disconnect();
    }, [getScroller]);

    return (
        <div ref={rootRef} className="nb-settings-step">
            {/* Docked like /settings (v6.3): pinned to the left edge, as tall as the step, its own scroll; a strip on phones. */}
            <aside data-settings-dock className="nbs-nav nb-sdock">
                <div className="nbs-nav-head">
                    <p className="nbs-eyebrow"><b>Starts with</b></p>
                    <label className="nbs-find">
                        <Search aria-hidden="true" />
                        <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" autoComplete="off" />
                    </label>
                </div>
                <nav aria-label="Starting settings sections" className="nbs-navnav">
                    <div ref={listRef} className="nbs-navlist">
                        <span data-nav-highlight className="nb-nav-hl" aria-hidden="true" style={highlight ? { transform: `translateY(${highlight.y}px)`, height: highlight.h, opacity: 1 } : { opacity: 0 }} />
                        {shownSections.map((section) => (
                            <button key={section.id} type="button" className="nbs-nl" aria-current={activeSection === section.id ? 'location' : undefined} onClick={() => goToSection(section.id)}>
                                <span className="t">{section.label}</span>
                                <span className="s" data-default={sectionState[section.id].changed ? undefined : ''}>{sectionState[section.id].state}</span>
                            </button>
                        ))}
                        {shownSections.length === 0 ? <p className="nb-nav-none">no setting matches</p> : null}
                    </div>
                </nav>
                <p className="nb-sdock-foot">
                    <span>{pad(changedCount)} of {pad(sections.length)} changed</span>
                    {changedCount ? <button type="button" className="nb-link text-[12.5px]" onClick={resetAllChanged}>Reset all</button> : null}
                </p>
            </aside>

            <div className="nb-settings-doc">
                <PhaseHead noun={isOrganization ? 'organization' : 'workspace'} step={isOrganization ? 'Setup' : 'Settings'} title="How it starts." line="Every choice starts at a sensible default and stays editable in Settings. Changed sections are marked." />
                {isOrganization ? (
                    <>
                        <LaunchSection {...sectionProps('calendar')} lead="Optional. The term sets the week line; planned sprints become the Journey on About.">
                            <OrgCalendarFields />
                        </LaunchSection>
                        <LaunchSection {...sectionProps('inside')} lead="Who creates workspaces in the organization, and the defaults new work starts with.">
                            <OrgSettingsFields />
                        </LaunchSection>
                    </>
                ) : null}

                {showValidationSummary && validationMessages.length > 0 ? (
                    <div role="alert" aria-live="assertive" className="border-l-2 border-destructive bg-[var(--status-danger-soft)] px-4 py-3 text-[13px] leading-[1.5] text-foreground">
                        <p className="font-semibold">Finish the {noun} links before continuing</p>
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

                <LaunchSection {...sectionProps('picture')} lead={`Shown on ${noun} cards, search and the header.`}>
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-input bg-muted/30 text-muted-foreground">
                            {imagePreviewUrl ? <img src={imagePreviewUrl} alt={`Selected ${noun} picture`} className="size-full object-cover" /> : <ImagePlus className="size-5" aria-hidden="true" />}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="outline" onClick={() => imageInputRef.current?.click()}>{projectImage ? 'Replace image' : 'Upload image'}</Button>
                            {projectImage ? <Button type="button" variant="ghost" onClick={() => onProjectImageChange(null)}><X aria-hidden="true" /> Remove</Button> : null}
                        </div>
                        <p className="nb-compact basis-full text-muted-foreground">PNG, JPG, WebP, or GIF up to 2 MB. Square works best; it is center-cropped. Uses initials if skipped.</p>
                        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ''; }} />
                    </div>
                </LaunchSection>

                <LaunchSection {...sectionProps('access')} lead={childOrg ? `${childOrg.title} sets the most open it can be.` : `Who can find the ${noun} now, and which tabs outsiders see.`}>
                    <fieldset className="nb-srows nb-srows-mid" aria-describedby="create-project-visibility-help">
                        <legend className="sr-only">{Noun} visibility</legend>
                        {(childOrg
                            ? [
                                { id: 'public' as const, label: 'Public', icon: Globe, description: `Anyone can discover the ${noun} and view its public tabs.` },
                                { id: 'org' as const, label: 'Organization', icon: Building2, description: `Every member of ${childOrg.title} can see it.` },
                                { id: 'private' as const, label: 'Private', icon: Lock, description: `The team and ${childOrg.title} admins.` },
                            ]
                            : [
                                { id: 'public' as const, label: 'Public', icon: Globe, description: `Anyone can discover the ${noun} and view its public tabs.` },
                                { id: 'private' as const, label: 'Private', icon: Lock, description: `Only members can see this ${noun} until you make it public.` },
                            ]).map((option) => {
                            const Icon = option.icon;
                            const isSelected = visibility === option.id;
                            // Choices above the org's cap show as locked rows (report §14.3).
                            const locked = Boolean(childOrg && !allowedChildVisibilities(childOrg.visibilityCap as VisibilityCap, childOrg.orgPublic).includes(option.id));
                            if (locked) {
                                return (
                                    <div key={option.id} className="flex items-start gap-3 border-b border-border px-[var(--nbs-pad)] py-4 text-muted-foreground last:border-b-0" aria-disabled="true">
                                        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                                        <span className="min-w-0"><span className="nb-ui-label block">{option.label}</span><span className="nb-compact mt-1 block">Set by {childOrg!.title}</span></span>
                                    </div>
                                );
                            }
                            return (
                                <label key={option.id} className={`flex cursor-pointer items-start gap-3 border-b border-border px-[var(--nbs-pad)] py-4 last:border-b-0 transition-[background-color,border-color] duration-[130ms] focus-within:bg-muted/30 ${isSelected ? 'bg-secondary/60' : 'hover:bg-muted/30'}`}>
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
                            ? PUBLIC_TAB_ORDER.filter((tab) => publicTabs[tab]).map((tab) => WORKSPACE_PUBLIC_TAB_LABELS[tab]).join(' · ') || `${Noun} title and card only`
                            : `Members only. Tab choices apply once you make the ${noun} public.`}
                    </p>
                </LaunchSection>

                <LaunchSection {...sectionProps('links')} lead="Website, repository, demo or community.">
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

                <LaunchSection {...sectionProps('documentation')} lead={`The ${noun}’s Documents tab: setup notes and how to take part.`}>
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
                        <div className="nb-srows mt-4">
                            <SwitchRow label={`Publish the document when the ${noun} is created`} description="Off: only the owner and admins can see it." checked={Boolean(readme?.publishOnCreate)} onCheckedChange={(checked) => set('readme', { ...readme, publishOnCreate: checked } as CreateWorkspaceInput['readme'])} />
                            <SwitchRow label="Members can edit the doc" description="Off: only the owner and admins can edit." checked={docEditPolicy === 'members'} onCheckedChange={(checked) => set('doc_edit_policy', checked ? 'members' : 'leaders')} />
                        </div>
                    ) : null}
                </LaunchSection>

                {isOrganization ? null : <LaunchSection {...sectionProps('lifecycle')} lead="Suggested from the category. Rename, reorder or add them to match how the work will go.">
                    <LifecycleEditor
                        stages={lifecycleStages}
                        onChange={(stages) => set('lifecycle_stages', stages)}
                        showCurrentStage={false}
                    />
                    <WizardWorkflowsField orgId={childOrg?.id ?? null} />
                </LaunchSection>}

                <LaunchSection {...sectionProps('permissions')} lead="The owner and admins can always do both. These apply to members who join later.">
                    <div className="nb-srows">
                        <SwitchRow label="Members can post updates" description="Progress posts on the Updates tab." checked={memberUpdatesEnabled !== false} onCheckedChange={(checked) => set('member_updates_enabled', checked)} />
                        <SwitchRow label="New members can upload files" description="The starting upload permission for each member; adjustable per member later." checked={memberFileUploadDefault !== false} onCheckedChange={(checked) => set('member_file_upload_default', checked)} />
                        {childOrg ? <SwitchRow label={`Follow ${childOrg.title}'s sprints`} description="New sprints link to the organization’s sprint holding their dates and stay inside it." checked={Boolean(followOrgSprints)} onCheckedChange={(checked) => set('follow_org_sprints', checked)} /> : null}
                    </div>
                </LaunchSection>

                <LaunchSection {...sectionProps('files')} lead={`Where the ${noun}’s files come from and who can add more.`}>
                    <div className="nb-srows">
                        <div className="nbs-row">
                            <div className="min-w-0"><p className="t">Source</p><p className="d">{sourceSummary}.</p></div>
                            <div className="ctl"><button type="button" className="nb-link text-[13px]" onClick={() => goToPhase?.(1)}>Change in Start</button></div>
                        </div>
                        {childOrg && templateFolders.length > 0 ? (
                            <div className="nbs-row">
                                <div className="min-w-0"><label htmlFor="org-template-folder" className="t block">From a {childOrg.title} template</label><p className="d">Copies the folder into the new workspace. The copies are yours to change.</p></div>
                                <div className="ctl">
                                    <select id="org-template-folder" value={templateFolderId ?? ''} onChange={(e) => set('org_template_folder_id', e.target.value || null)} className="nb-select" data-size="sm">
                                        <option value="">None</option>
                                        {templateFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        ) : null}
                        <div className="nbs-row">
                            <div className="min-w-0"><p className="t">Uploads</p><p className="d">The owner and admins can always upload. New members {memberFileUploadDefault !== false ? 'can upload' : 'can’t upload'} (Permissions).</p></div>
                        </div>
                    </div>
                </LaunchSection>

                <LaunchSection {...sectionProps('notifications')} lead="Each member can still tune their own. Membership and security alerts always stay on.">
                    <div className="nb-srows">
                        {CREATE_WORKSPACE_NOTIFICATION_ROWS.map((row) => (
                            <SwitchRow key={row.id} label={row.label} description={row.description} checked={notificationRows[row.id]} onCheckedChange={(checked) => set('notification_rows', { ...notificationRows, [row.id]: checked })} />
                        ))}
                    </div>
                    <p className="nb-compact mt-3 text-muted-foreground">Membership and security alerts always stay on.</p>
                </LaunchSection>

                <p className="mt-6 text-[13px] leading-[1.5] text-muted-foreground">
                    Members, invitations and {noun} management are in Settings after it’s created.
                </p>
            </div>
        </div>
    );
}
