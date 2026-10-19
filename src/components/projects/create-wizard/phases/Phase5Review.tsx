'use client';

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Edit3, Folder, GitBranch, Globe, Lock } from 'lucide-react';
import { CreateProjectInput } from '@/lib/validations/project';
import { SkillList } from '@/components/skills/SkillList';
import { Button } from '@/components/ui/button';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projects/project-create-options';
import { resolveSocialPresence, socialLinkItemsFromStorage } from '@/lib/profile/normalization';
import { CREATE_PROJECT_NOTIFICATION_ROWS } from '@/lib/notifications/project-policy';
import { DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY, PROJECT_PUBLIC_TAB_LABELS, type ProjectPublicTabId } from '@/lib/projects/settings-policies';
import ProjectCard from '@/components/projects/ProjectCard';
import { useAuth } from '@/hooks/useAuth';
import type { Project } from '@/types/discover';

interface Phase5ReviewProps {
    goToPhase: (phase: 1 | 2 | 3 | 4) => void;
    onReady: () => void;
    /** Step 4 picture lives outside the form until it is uploaded after creation. */
    projectImage?: File | null;
}

const PUBLIC_TAB_ORDER: ProjectPublicTabId[] = ['dashboard', 'readme', 'updates', 'files', 'sprints', 'tasks'];

interface ReviewSectionProps {
    eyebrow: string;
    title: string;
    onEdit: () => void;
    children: ReactNode;
}

function ReviewSection({ eyebrow, title, onEdit, children }: ReviewSectionProps) {
    return (
        <section className="border-t border-border pt-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="nb-meta font-mono uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p>
                    <h4 className="nb-card-title mt-1 text-foreground">{title}</h4>
                </div>
                <Button type="button" onClick={onEdit} variant="link" size="sm" className="nb-touch-target shrink-0">
                    <Edit3 className="size-3" />
                    Edit
                </Button>
            </div>
            <div className="mt-4 border-y border-border">{children}</div>
        </section>
    );
}

interface ReviewRowProps {
    label: string;
    icon?: ComponentType<{ className?: string }>;
    children: ReactNode;
}

function ReviewRow({ label, icon: Icon, children }: ReviewRowProps) {
    return (
        <div className={`border-b border-border py-3.5 last:border-b-0${Icon ? " flex gap-3" : ""}`}>
            {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            <div className="min-w-0 flex-1">
                <p className="nb-meta text-muted-foreground">{label}</p>
                <div className="mt-1 text-foreground">{children}</div>
            </div>
        </div>
    );
}

function DetailLabel({ children }: { children: ReactNode }) {
    return (
        <span className="inline-flex rounded-[3px] border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-foreground">
            {children}
        </span>
    );
}

const sourceCopy = {
    scratch: {
        title: 'Start from scratch',
        detail: 'A new project will be created without imported files.',
        icon: Folder,
    },
    github: {
        title: 'Import from GitHub',
        detail: 'Repository files and the selected branch will be imported after creation.',
        icon: GitBranch,
    },
    upload: {
        title: 'Upload a folder',
        detail: 'The selected local project files will be uploaded after creation.',
        icon: Folder,
    },
};

export default function Phase5Review({ goToPhase, onReady, projectImage = null }: Phase5ReviewProps) {
    const { control } = useFormContext<CreateProjectInput>();
    const formData = useWatch({ control }) as CreateProjectInput;

    useEffect(() => {
        onReady();
    }, [onReady]);

    const openRoles = (formData.roles || []).filter((role) => role.role.trim().length > 0);
    const openPositionCount = openRoles.reduce((total, role) => total + role.count, 0);
    const projectLinks = socialLinkItemsFromStorage(formData.external_links);
    const projectType = PROJECT_TYPE_OPTIONS.find((type) => type.id === formData.project_type);
    const projectTypeLabel = formData.project_type === 'other'
        ? formData.custom_project_type || 'Custom category'
        : projectType?.label || 'No category selected';
    const sourceType = formData.import_source?.type || 'scratch';
    const source = sourceCopy[sourceType];
    const SourceIcon = source.icon;
    const sourceMetadata = formData.import_source?.metadata || {};
    const uploadFileCount = Number(sourceMetadata.fileCount || 0);
    const lifecycleStages = formData.lifecycle_stages || [];
    const VisibilityIcon = formData.visibility === 'private' ? Lock : Globe;
    const publicTabs = { ...DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY, ...(formData.public_tab_visibility || {}) };
    const publicTabLabels = PUBLIC_TAB_ORDER.filter((tab) => publicTabs[tab]).map((tab) => PROJECT_PUBLIC_TAB_LABELS[tab]);
    const docSkipped = formData.readme?.mode === 'skip';
    const notificationRows = { roles_applications: true, work: true, updates_docs: true, ...(formData.notification_rows || {}) };
    const memberUpdates = formData.member_updates_enabled !== false;
    const memberUploads = formData.member_file_upload_default !== false;

    const { user } = useAuth();
    const [previewCoverUrl, setPreviewCoverUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!projectImage) {
            setPreviewCoverUrl(null);
            return;
        }
        const url = URL.createObjectURL(projectImage);
        setPreviewCoverUrl(url);
        return () => {
            URL.revokeObjectURL(url);
        };
    }, [projectImage]);

    const previewProject: Project = useMemo(() => {
        return {
            id: 'preview-project',
            key: 'PRV',
            title: formData.title || 'Untitled project',
            description: formData.description || '',
            shortDescription: formData.short_description || '',
            slug: 'preview',
            status: 'draft',
            syncStatus: 'ready',
            visibility: formData.visibility === 'private' ? 'private' : 'public',
            category: formData.project_type === 'other' ? formData.custom_project_type || 'Other' : formData.project_type || 'General',
            coverImageUrl: previewCoverUrl || undefined,
            avatarUrl: previewCoverUrl || undefined,
            skills: [...(formData.tags || []), ...(formData.technologies_used || [])],
            externalLinks: formData.external_links || {},
            githubRepoUrl: formData.import_source?.repoUrl || undefined,
            owner: user ? {
                id: user.id,
                fullName: user.user_metadata?.full_name || user.email || 'You',
                displayName: user.user_metadata?.full_name || 'You',
                username: user.user_metadata?.user_name || 'you',
                avatarUrl: user.user_metadata?.avatar_url || null,
            } : {
                id: 'you',
                fullName: 'You',
                displayName: 'You',
                username: 'you',
                avatarUrl: null,
            },
            openRoles: (formData.roles || []).map((r, i) => ({
                id: `role-${i}`,
                projectId: 'preview-project',
                role: r.role,
                count: r.count,
                filled: 0,
                skills: r.skills || [],
                description: r.description,
            })),
            collaboratorsCount: 1,
            followersCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        } as unknown as Project;
    }, [formData, previewCoverUrl, user]);

    return (
        <div className="min-w-0 w-full space-y-8 pb-6">
            <header className="max-w-2xl">
                <p className="nb-meta font-mono uppercase tracking-[0.12em] text-muted-foreground">Phase 5 · review</p>
                <h3 className="nb-section-title mt-2 text-foreground">Review before creating</h3>
                <p className="nb-body mt-2 text-muted-foreground">
                    Confirm what collaborators will see at launch. Use Edit to return to the relevant phase; the project is created only when you choose Create project in the footer.
                </p>
            </header>

            {/* Mobile / Tablet Card Preview */}
            <div className="lg:hidden">
                <p className="nb-meta mb-2 font-mono uppercase tracking-[0.12em] text-muted-foreground">Card preview</p>
                <div className="pointer-events-none select-none">
                    <ProjectCard project={previewProject} />
                </div>
            </div>

            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
                <div className="min-w-0 space-y-8">
                    <ReviewSection eyebrow="Phase 1 · start" title="Starting point" onEdit={() => goToPhase(1)}>
                        <ReviewRow label="Source" icon={SourceIcon}>
                            <p className="nb-ui-label text-foreground">{source.title}</p>
                            <p className="nb-compact mt-1 text-muted-foreground">{source.detail}</p>
                        </ReviewRow>
                {sourceType === 'github' ? (
                    <>
                        <ReviewRow label="Repository" icon={GitBranch}>
                            <p className="nb-body break-all text-foreground">{formData.import_source?.repoUrl || 'No repository selected'}</p>
                        </ReviewRow>
                        <ReviewRow label="Branch">
                            <DetailLabel>{formData.import_source?.branch || 'Default branch'}</DetailLabel>
                        </ReviewRow>
                    </>
                ) : null}
                {sourceType === 'upload' ? (
                    <ReviewRow label="Folder contents" icon={Folder}>
                        <p className="nb-body text-foreground">
                            {uploadFileCount > 0
                                ? `${uploadFileCount} ${uploadFileCount === 1 ? 'file is' : 'files are'} ready to upload.`
                                : 'The selected folder is ready to upload.'}
                        </p>
                    </ReviewRow>
                ) : null}
            </ReviewSection>

            <ReviewSection eyebrow="Phase 2 · information" title="Project details" onEdit={() => goToPhase(2)}>
                <ReviewRow label="Project title">
                    <p className="nb-body font-medium text-foreground">{formData.title || 'Untitled project'}</p>
                </ReviewRow>
                <ReviewRow label="Category">
                    <p className="nb-body text-foreground">{projectTypeLabel}</p>
                    {projectType?.description ? <p className="nb-compact mt-1 text-muted-foreground">{projectType.description}</p> : null}
                </ReviewRow>
                {formData.short_description ? (
                    <ReviewRow label="Tagline">
                        <p className="nb-body text-foreground">{formData.short_description}</p>
                    </ReviewRow>
                ) : null}
                <ReviewRow label="Description">
                    <p className="nb-body whitespace-pre-wrap text-foreground">{formData.description || 'No description added.'}</p>
                </ReviewRow>
                {formData.problem_statement || formData.solution_statement ? (
                    <div className="grid border-b border-border md:grid-cols-2">
                        {formData.problem_statement ? (
                            <div className="border-b border-border px-0 py-3.5 md:border-b-0 md:border-r md:px-4 md:first:pl-0">
                                <p className="nb-meta text-muted-foreground">Problem</p>
                                <p className="nb-compact mt-1 whitespace-pre-wrap text-foreground">{formData.problem_statement}</p>
                            </div>
                        ) : null}
                        {formData.solution_statement ? (
                            <div className="px-0 py-3.5 md:px-4 md:last:pr-0">
                                <p className="nb-meta text-muted-foreground">Solution</p>
                                <p className="nb-compact mt-1 whitespace-pre-wrap text-foreground">{formData.solution_statement}</p>
                            </div>
                        ) : null}
                    </div>
                ) : null}
                <ReviewRow label="Tags and technologies">
                    {formData.tags?.length || formData.technologies_used?.length ? (
                        <div className="flex flex-wrap gap-2">
                            {formData.tags?.map((tag) => <DetailLabel key={tag}>{tag}</DetailLabel>)}
                            <SkillList skills={formData.technologies_used || []} size="sm" />
                        </div>
                    ) : <p className="nb-compact text-muted-foreground">No tags or technologies added.</p>}
                </ReviewRow>
            </ReviewSection>

            <ReviewSection eyebrow="Phase 3 · team" title="Team and roles" onEdit={() => goToPhase(3)}>
                <ReviewRow label="Project lead">
                    <p className="nb-ui-label text-foreground">Lead{formData.creator_role?.title ? ` · ${formData.creator_role.title}` : ''}</p>
                    {formData.creator_role?.time_commitment ? <p className="nb-compact mt-1 text-muted-foreground">{formData.creator_role.time_commitment} hours per week</p> : null}
                </ReviewRow>
                <ReviewRow label="Open roles">
                    {openRoles.length ? (
                        <div className="space-y-4">
                            <p className="nb-compact text-muted-foreground">{openPositionCount} open {openPositionCount === 1 ? 'position' : 'positions'} across {openRoles.length} {openRoles.length === 1 ? 'role' : 'roles'}.</p>
                            {openRoles.map((role, index) => (
                                <div key={`${role.role}-${index}`} className="border-l-2 border-primary pl-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="nb-ui-label text-foreground">{role.role}</p>
                                        <DetailLabel>{role.count} {role.count === 1 ? 'opening' : 'openings'}</DetailLabel>
                                        <DetailLabel>{role.experienceLevel || 'any'}</DetailLabel>
                                        <DetailLabel>{(role.compensationType || 'unpaid').replace('_', ' ')}</DetailLabel>
                                    </div>
                                    {role.description ? <p className="nb-compact mt-2 whitespace-pre-wrap text-muted-foreground">{role.description}</p> : null}
                                    {role.skills?.length ? <div className="mt-2"><SkillList skills={role.skills} size="sm" /></div> : null}
                                </div>
                            ))}
                        </div>
                    ) : <p className="nb-compact text-muted-foreground">No open roles added.</p>}
                </ReviewRow>
            </ReviewSection>

            <ReviewSection eyebrow="Phase 4 · settings" title="Launch settings" onEdit={() => goToPhase(4)}>
                <ReviewRow label="Project picture">
                    <p className="nb-compact text-foreground">{projectImage ? `${projectImage.name} · uploads after creation` : 'Initials until a picture is added.'}</p>
                </ReviewRow>
                <ReviewRow label="Visibility" icon={VisibilityIcon}>
                    <p className="nb-ui-label text-foreground">{formData.visibility === 'private' ? 'Private project' : 'Public project'}</p>
                    <p className="nb-compact mt-1 text-muted-foreground">
                        {formData.visibility === 'private'
                            ? 'Only collaborators can access the project at launch.'
                            : `Public tabs: ${publicTabLabels.join(' · ') || 'none'}.`}
                    </p>
                </ReviewRow>
                <ReviewRow label="Project links">
                    {projectLinks.length ? (
                        <ul className="space-y-3">
                            {projectLinks.map((link) => {
                                const resolved = resolveSocialPresence(link.platform, link.url);
                                const title = link.label || link.destinationLabel || resolved?.platformLabel || 'Project link';
                                const secondary = link.destinationLabel && link.destinationLabel !== title
                                    ? link.destinationLabel
                                    : resolved?.accountLabel || link.url;
                                return (
                                    <li key={link.id} className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="nb-ui-label text-foreground">{title}</p>
                                            <DetailLabel>{link.audience === 'members' ? 'Members only' : 'Public'}</DetailLabel>
                                            {link.purpose ? <DetailLabel>{link.purpose.replaceAll('-', ' ')}</DetailLabel> : null}
                                        </div>
                                        <p className="nb-compact mt-1 truncate text-muted-foreground" title={link.url}>{secondary}</p>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : <p className="nb-compact text-muted-foreground">No project links added.</p>}
                </ReviewRow>
                <ReviewRow label="Documentation">
                    <p className="nb-compact text-foreground">
                        {docSkipped
                            ? 'No doc yet.'
                            : `Starter template, ${formData.readme?.publishOnCreate ? 'published at launch' : 'kept as a draft'}. ${formData.doc_edit_policy === 'members' ? 'Members can edit.' : 'Leaders edit.'}`}
                    </p>
                </ReviewRow>
                <ReviewRow label="Project journey">
                    {lifecycleStages.length ? (
                        <ol className="space-y-2">
                            {lifecycleStages.map((stage, index) => (
                                <li key={`${stage}-${index}`} className="flex items-center gap-2">
                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-[3px] border border-border font-mono text-[11px] text-muted-foreground">{index + 1}</span>
                                    <span className="nb-compact text-foreground">{stage}</span>
                                </li>
                            ))}
                        </ol>
                    ) : <p className="nb-compact text-muted-foreground">No journey stages added.</p>}
                </ReviewRow>
                <ReviewRow label="Team permissions">
                    <p className="nb-compact text-foreground">Updates: {memberUpdates ? 'members can post' : 'leaders only'} · New-member uploads: {memberUploads ? 'on' : 'off'}</p>
                </ReviewRow>
                <ReviewRow label="Files and storage">
                    <p className="nb-compact text-foreground">{source.detail}</p>
                </ReviewRow>
                <ReviewRow label="Notifications">
                    <p className="nb-compact text-foreground">
                        {CREATE_PROJECT_NOTIFICATION_ROWS.map((row) => `${row.label}: ${notificationRows[row.id] ? 'on' : 'off'}`).join(' · ')}
                    </p>
                    <p className="nb-compact mt-1 text-muted-foreground">Membership and security alerts always stay on.</p>
                </ReviewRow>
            </ReviewSection>

                    <aside className="border-l-2 border-primary bg-secondary/35 px-4 py-3.5" aria-label="Creation confirmation">
                        <p className="nb-ui-label text-foreground">Ready to create</p>
                        <p className="nb-compact mt-1 text-muted-foreground">Nothing has been created yet. Create the project only when you select Create project in the footer.</p>
                    </aside>
                </div>

                {/* Desktop Sticky Card Preview (>= lg) */}
                <aside aria-label="Project card preview" className="hidden lg:block sticky top-24 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="nb-meta font-mono uppercase tracking-[0.12em] text-muted-foreground">Card preview</p>
                        <span className="nb-compact font-mono text-[11px] text-muted-foreground">Live preview</span>
                    </div>
                    <div className="pointer-events-none select-none">
                        <ProjectCard project={previewProject} />
                    </div>
                    <p className="nb-compact text-muted-foreground">
                        This is how your project card will appear in Discover and search results.
                    </p>
                </aside>
            </div>
        </div>
    );
}
