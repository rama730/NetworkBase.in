'use client';

import { useCreateLocation } from '@/components/organizations/CreateLocation';
import { PhaseHead } from '../PhaseHead';
import { phaseProblems } from '../phase-problems';
import { createSteps } from '../create-steps';
import { settingsChanges, ORG_SETTINGS_SECTIONS, WORKSPACE_SETTINGS_SECTIONS, type SettingsSectionId } from '../settings-changes';
import { typeProfile } from '@/lib/organizations/type-profile'
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Pencil } from 'lucide-react';
import { CreateWorkspaceInput } from '@/lib/validations/workspace';
import { SkillList } from '@/components/skills/SkillList';
import { WORKSPACE_TYPE_OPTIONS } from '@/lib/workspaces/workspace-create-options';
import { resolveSocialPresence, socialLinkItemsFromStorage } from '@/lib/profile/normalization';
import { CREATE_WORKSPACE_NOTIFICATION_ROWS } from '@/lib/notifications/workspace-policy';
import { DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY, WORKSPACE_PUBLIC_TAB_LABELS, type WorkspacePublicTabId } from '@/lib/workspaces/settings-policies';
import ProjectCard from '@/components/workspaces/WorkspaceCard';
import { WorkspaceSearchResultCard } from '@/components/layout/header/GlobalSearchResultCards';
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch';
import { TabMarker } from '@/components/ui/TabMarker';
import { PixelTick } from '@/components/ui/PixelTick';
import { orgTypeLabel } from '@/lib/organizations/config';
import { ORG_CREATION_COPY, orgTypeDefaults } from '@/lib/organizations/creation';
import { parseInviteEmails } from '@/lib/organizations/member-rules';
import { useAuth } from '@/hooks/useAuth';
import type { Workspace } from '@/types/discover';
import { buildPreviewWorkspace } from '../preview-workspace';

interface Phase5ReviewProps {
    goToPhase: (phase: 1 | 2 | 3 | 4) => void;
    onReady: () => void;
    /** Step 4 picture lives outside the form until it is uploaded after creation. */
    projectImage?: File | null;
}

type Step = 1 | 2 | 3 | 4;
const PUBLIC_TAB_ORDER: WorkspacePublicTabId[] = ['dashboard', 'readme', 'updates', 'files', 'sprints', 'tasks'];
const pad = (n: number) => String(n).padStart(2, '0');

/** One step as a frame (v6.7): its summary line until opened, then its rows. Edit goes to the step; the footer then
 *  offers Back to Review. */
function ReviewSection({ step, label, line, open, onToggle, onEdit, children }: { step: Step; label: string; line: string; open: boolean; onToggle: () => void; onEdit: () => void; children: ReactNode }) {
    return (
        <section data-review-section={step} aria-labelledby={`review-step-${step}`} className="nbs-frame">
            <p className="nbs-glabel pt-[18px]" id={`review-step-${step}`}>
                {label}
                <span className="r">
                    {open ? <button type="button" className="nb-link text-[13px]" aria-expanded="true" onClick={onToggle}>Hide</button> : null}
                    <button type="button" className="nb-link inline-flex items-center gap-1 text-[13px]" onClick={onEdit}><Pencil className="size-3" aria-hidden="true" />Edit</button>
                </span>
            </p>
            {open ? <div className="nb-rv-rows nb-enter-reveal">{children}</div> : (
                <button type="button" data-review-line className="nb-rv-line" aria-expanded="false" onClick={onToggle}>
                    <span className="min-w-0 truncate">{line}</span><span className="nb-meta shrink-0">Show</span>
                </button>
            )}
        </section>
    );
}

function ReviewRow({ label, tag, children }: { label: string; tag?: 'Changed' | 'Default'; children: ReactNode }) {
    return (
        <div className="nb-rv">
            <span className="nb-rv-l">{label}</span>
            <div className="min-w-0 text-[14px] text-foreground">{children}</div>
            {tag ? <span className={`nbs-tag${tag === 'Changed' ? ' hot' : ''}`}>{tag}</span> : <span />}
        </div>
    );
}

function DetailLabel({ children }: { children: ReactNode }) {
    return <span className="nbs-tag">{children}</span>;
}

export default function Phase5Review({ goToPhase, onReady, projectImage = null }: Phase5ReviewProps) {
    const { control } = useFormContext<CreateWorkspaceInput>();
    const formData = useWatch({ control }) as CreateWorkspaceInput;
    const childOrg = useCreateLocation().org;
    const { user } = useAuth();
    // The team line, report §14.3 Phase 5: "4 added · 3 invited · 1 open seat". People outside the org are always invited.
    const placed = [...(formData.roles ?? []).flatMap((role) => role.people ?? []), ...(formData.unassigned_people ?? [])] as Array<{ outside?: boolean }>;
    const teamCount = placed.length;
    const outsideCount = placed.filter((person) => person.outside).length;
    const addedCount = childOrg?.isAdmin ? teamCount - outsideCount : 0;
    const invitedCount = teamCount - addedCount;
    const openSeats = (formData.roles ?? []).reduce((n, role) => n + Math.max(0, (role.count ?? 0) - (role.people?.length ?? 0)), 0);

    useEffect(() => {
        onReady();
    }, [onReady]);

    const openRoles = (formData.roles || []).filter((role) => role.role.trim().length > 0);
    const openPositionCount = openRoles.reduce((total, role) => total + role.count, 0);
    const projectLinks = socialLinkItemsFromStorage(formData.external_links);
    const projectType = WORKSPACE_TYPE_OPTIONS.find((type) => type.id === formData.project_type);
    // Organizations (report §34.7): their own words, the type's label and gentle checks that never block.
    const org = formData.organization;
    const problemCount = phaseProblems(formData, { uploadReady: true });
    const reviewReady = problemCount[1] + problemCount[2] + problemCount[3] === 0;
    // One noun for this step (org design plan CR1).
    const noun = org ? 'organization' : 'workspace';
    const Noun = org ? 'Organization' : 'Workspace';
    const orgRoles = org ? org.role_names ?? orgTypeDefaults(org.org_type ?? 'other').roleNames : null;
    const orgInvites = org?.invite_emails ? parseInviteEmails(org.invite_emails).valid.length : 0;
    const projectTypeLabel = org ? formData.custom_project_type?.trim() || 'No subject added' : formData.project_type === 'other'
        ? formData.custom_project_type || 'Other'
        : projectType?.label || 'No category selected';
    const sourceType = formData.import_source?.type || 'scratch';
    const sourceMetadata = (formData.import_source?.metadata || {}) as { folderName?: string; fileCount?: number };
    const uploadFileCount = Number(sourceMetadata.fileCount || 0);
    const repo = formData.import_source?.repoUrl?.replace(/^https:\/\/github\.com\//, '') || 'a GitHub repository';
    const sourceLine = sourceType === 'github' ? `${repo} · ${formData.import_source?.branch || 'default branch'}, imported after it’s made`
        : sourceType === 'upload' ? `${sourceMetadata.folderName || 'your folder'}/ from this device · ${uploadFileCount} files`
        : 'From scratch';
    const lifecycleStages = formData.lifecycle_stages || [];
    const publicTabs = { ...DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY, ...(formData.public_tab_visibility || {}) };
    const publicTabLabels = PUBLIC_TAB_ORDER.filter((tab) => publicTabs[tab]).map((tab) => WORKSPACE_PUBLIC_TAB_LABELS[tab]);
    const docSkipped = formData.readme?.mode === 'skip';
    const notificationRows = { roles_applications: true, work: true, updates_docs: true, ...(formData.notification_rows || {}) };
    const memberUpdates = formData.member_updates_enabled !== false;
    const memberUploads = formData.member_file_upload_default !== false;
    const visibilityWord = formData.visibility === 'private' ? 'Private' : formData.visibility === 'org' ? `${childOrg?.title ?? 'Organization'} members` : 'Public';
    const ownerName = (user?.user_metadata?.full_name as string | undefined) || 'You';

    // Settings: what changed from where it started (shared with the Settings step).
    const changes = settingsChanges(formData, { childOrg, hasPicture: Boolean(projectImage) });
    const settingsIds = org ? ORG_SETTINGS_SECTIONS : WORKSPACE_SETTINGS_SECTIONS;
    const changedCount = settingsIds.filter((id) => changes[id]).length;
    const [changedOnly, setChangedOnly] = useState(false);
    const [open, setOpen] = useState<Set<Step>>(() => new Set());
    const isOpen = (step: Step) => open.has(step) || (changedOnly && step === 4);
    const toggle = (step: Step) => setOpen((current) => { const next = new Set(current); if (next.has(step)) next.delete(step); else next.add(step); return next; });
    const allOpen = ([1, 2, 3, 4] as Step[]).every(isOpen);
    const tag = (id: SettingsSectionId): 'Changed' | 'Default' => (changes[id] ? 'Changed' : 'Default');
    const showSetting = (id: SettingsSectionId) => !changedOnly || changes[id];

    // The check-up: what Create needs, each with Fix.
    const required: Array<[string, boolean, Step]> = org
        ? [['Kind of organization', problemCount[1] === 0, 1], ['Name', (formData.title ?? '').trim().length >= 3, 2], ['Web address', Boolean(org.handle?.trim()), 2], ['Description', (formData.description ?? '').trim().length >= 20, 2]]
        : [['Starting point', problemCount[1] === 0, 1], ['Name', (formData.title ?? '').trim().length >= 3, 2],
            ['Category', Boolean(formData.project_type) && (formData.project_type !== 'other' || Boolean(formData.custom_project_type?.trim())), 2],
            ['Description', (formData.description ?? '').trim().length >= 20, 2], ['Roles complete', problemCount[3] === 0, 3]];
    const doneCount = required.filter(([, ok]) => ok).length;
    const worth: Array<[string, string, Step]> = (org
        ? [[!formData.organization?.welcome_note?.trim(), 'Welcome note', 'People see it right after they join.', 2], [!org.co_admins?.length, 'Co-admins', 'You’ll run it alone until you add one.', 3], [!projectImage, 'Picture', 'A pixel picture is used until you add one.', 4]]
        : [[!projectImage, 'Picture', 'A pixel picture is used until you add one.', 4], [!formData.short_description?.trim(), 'Summary', 'The card uses the description’s first sentence.', 2],
            [!(formData.tags || []).length, 'Tags', 'Tags help people find it on Discover.', 2], [!openRoles.length, 'Open roles', 'People can follow it, but can’t apply.', 3],
            [!projectLinks.length, 'Links', 'No website, repository or demo linked.', 4]]
    ).filter(([missing]) => missing).map(([, label, line, step]) => [label as string, line as string, step as Step]);

    const lines: Record<Step, string> = org ? {
        1: orgTypeLabel(org.org_type, { typeLabel: org.type_label }) ?? 'Organization',
        2: `${formData.title || '—'} · networkbase.in/org/${org.handle || '…'}`,
        3: orgRoles ? `${[orgRoles.owner, orgRoles.admin, orgRoles.member, orgRoles.viewer].join(' · ')} · ${org.co_admins?.length ?? 0} co-admins` : 'People',
        4: `${visibilityWord} · ${changedCount} changed from defaults`,
    } : {
        1: `${childOrg?.title ?? 'Personal'} · ${sourceType === 'scratch' ? 'From scratch' : sourceType === 'github' ? repo : `${sourceMetadata.folderName || 'your folder'}/ from this device`}`,
        2: `${formData.title || '—'} · ${projectTypeLabel} · ${(formData.tags?.length ?? 0) + (formData.technologies_used?.length ?? 0)} tags and skills`,
        3: `${ownerName} · ${openRoles.length} ${openRoles.length === 1 ? 'role' : 'roles'}, ${openPositionCount} ${openPositionCount === 1 ? 'opening' : 'openings'}`,
        4: `${visibilityWord} · ${lifecycleStages.length} stages · ${changedCount} changed from defaults`,
    };

    const steps = createSteps(formData, { uploadCount: uploadFileCount, peopleCount: teamCount, orgTitle: childOrg?.title });

    // Where it shows (v6.7): the real Discover card, the search row, and the org's Workspaces tab.
    const [where, setWhere] = useState<'discover' | 'search' | 'org'>('discover');
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

    const previewProject: Workspace = useMemo(() => buildPreviewWorkspace(formData, {
        noun, coverUrl: previewCoverUrl, user,
        // The card shows the org above the title on Discover (report §14.3 Phase 5); its own tab leaves it out.
        cardOrg: childOrg && where === 'discover' ? { id: childOrg.id, title: childOrg.title, slug: childOrg.slug } : undefined,
    }), [formData, previewCoverUrl, user, childOrg, noun, where]);

    const whereOptions = [
        { id: 'discover' as const, label: 'Discover' },
        ...(org ? [] : [{ id: 'search' as const, label: 'Search' }]),
        ...(childOrg ? [{ id: 'org' as const, label: `${childOrg.title} tab` }] : []),
    ];

    return (
        <div className="min-w-0 w-full pb-6">
            <PhaseHead noun={org ? 'organization' : 'workspace'} step="Review" title={reviewReady ? 'Ready to create.' : 'Almost there.'} line="Nothing is made until you press Create. Edit takes you to that step; Back to Review brings you straight here." />

            <div className="nb-review">
                <div className="min-w-0">
                    <div data-review-bar className="nb-review-bar">
                        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{changedCount} of {settingsIds.length} settings changed</span>
                        <label className="inline-flex items-center gap-2 text-[13px]">
                            <SettingsSwitch checked={changedOnly} onCheckedChange={setChangedOnly} aria-label="Show only what I changed" />
                            Show only what I changed
                        </label>
                        <button type="button" className="nb-link ml-auto text-[13px]" onClick={() => setOpen(allOpen ? new Set() : new Set([1, 2, 3, 4]))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
                    </div>

                    <ReviewSection step={1} label="Start" line={lines[1]} open={isOpen(1)} onToggle={() => toggle(1)} onEdit={() => goToPhase(1)}>
                        <ReviewRow label="Lives in">{childOrg ? <>{childOrg.title}<p className="nb-rv-s">It shows at the top of {childOrg.title}’s Workspaces tab.</p></> : org ? 'Its own organization' : 'Personal'}</ReviewRow>
                        <ReviewRow label="Source">{org ? `${orgTypeLabel(org.org_type, { typeLabel: org.type_label })}. It starts empty; workspaces are added inside it.` : sourceLine}</ReviewRow>
                    </ReviewSection>

                    <ReviewSection step={2} label={org ? 'Details' : 'Info'} line={lines[2]} open={isOpen(2)} onToggle={() => toggle(2)} onEdit={() => goToPhase(2)}>
                        <ReviewRow label="Name">
                            <span className="font-medium">{formData.title || `Untitled ${noun}`}</span>
                            {!org && formData.slug ? <p className="nb-rv-s font-mono">networkbase.in/w/{formData.slug}</p> : null}
                            {org ? <p className="nb-rv-s font-mono">networkbase.in/org/{org.handle}</p> : null}
                        </ReviewRow>
                        <ReviewRow label={org ? ORG_CREATION_COPY[org.org_type ?? 'other'].subjectLabel : 'Category'}>{projectTypeLabel}</ReviewRow>
                        {formData.short_description ? <ReviewRow label="Summary">{formData.short_description}</ReviewRow> : null}
                        <ReviewRow label={org ? 'About' : 'Description'}><p className="whitespace-pre-wrap">{formData.description || 'No description added.'}</p></ReviewRow>
                        {formData.problem_statement ? <ReviewRow label={org ? 'Who it’s for' : 'Problem'}><p className="whitespace-pre-wrap">{formData.problem_statement}</p></ReviewRow> : null}
                        {formData.solution_statement ? <ReviewRow label={org ? 'What members do here' : 'Approach'}><p className="whitespace-pre-wrap">{formData.solution_statement}</p></ReviewRow> : null}
                        {org ? (
                            <ReviewRow label="Place">{[org.part_of ? `Part of ${org.part_of}` : null, org.location || null, org.time_zone || null].filter(Boolean).join(' · ') || 'No place added'}</ReviewRow>
                        ) : null}
                        <ReviewRow label={org ? 'Topics' : 'Tags and skills'}>
                            {formData.tags?.length || formData.technologies_used?.length ? (
                                <div className="flex flex-wrap gap-2">
                                    {formData.tags?.map((t) => <DetailLabel key={t}>{t}</DetailLabel>)}
                                    <SkillList skills={formData.technologies_used || []} size="sm" />
                                </div>
                            ) : <span className="text-muted-foreground">None added.</span>}
                        </ReviewRow>
                    </ReviewSection>

                    <ReviewSection step={3} label={org ? 'People' : 'Team'} line={lines[3]} open={isOpen(3)} onToggle={() => toggle(3)} onEdit={() => goToPhase(3)}>
                        {org && orgRoles ? (
                            <>
                                <ReviewRow label="Roles">{orgRoles.owner} · {orgRoles.admin} · {orgRoles.member} · {orgRoles.viewer}{org.creator_title ? ` · you’re ${org.creator_title}` : ''}</ReviewRow>
                                <ReviewRow label="Joining">
                                    {[org.co_admins?.length ? `${org.co_admins.length} ${org.co_admins.length === 1 ? 'co-admin' : 'co-admins'} invited` : null,
                                        orgInvites ? `${orgInvites} member ${orgInvites === 1 ? 'invite' : 'invites'}` : null,
                                        org.join_mode === 'approval' ? 'Joining needs approval' : 'Anyone with the code joins',
                                        org.max_members ? `up to ${org.max_members} members` : null].filter(Boolean).join(' · ')}
                                </ReviewRow>
                            </>
                        ) : (
                            <>
                                <ReviewRow label="Owner">{formData.lead_user_id ? 'The lead you picked' : ownerName}{formData.creator_role?.title ? ` · ${formData.creator_role.title}` : ''}{formData.lead_user_id && childOrg ? <p className="nb-rv-s">You stay an admin through {childOrg.title}.</p> : null}</ReviewRow>
                                {childOrg ? (
                                    <ReviewRow label="People">
                                        {teamCount === 0 ? 'No one placed yet' : [addedCount ? `${addedCount} added` : null, invitedCount ? `${invitedCount} invited` : null].filter(Boolean).join(' · ')}
                                        {openSeats > 0 ? ` · ${openSeats} open ${openSeats === 1 ? 'seat' : 'seats'}` : ''}
                                        <p className="nb-rv-s">{childOrg.title}’s owner and admins can see and help with this workspace.</p>
                                    </ReviewRow>
                                ) : null}
                                <ReviewRow label="Open roles">
                                    {openRoles.length ? (
                                        <div className="space-y-3">
                                            {openRoles.map((role, index) => (
                                                <div key={`${role.role}-${index}`}>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-medium">{role.role}</span>
                                                        <DetailLabel>{role.count} {role.count === 1 ? 'opening' : 'openings'}</DetailLabel>
                                                        <DetailLabel>{role.experienceLevel || 'any'}</DetailLabel>
                                                        {!childOrg || typeProfile(childOrg.orgType).showCompensation ? <DetailLabel>{(role.compensationType || 'unpaid').replace('_', ' ')}</DetailLabel> : null}
                                                        {role.lead_user_id ? <DetailLabel>★ {role.people?.find((person) => person.user_id === role.lead_user_id)?.label ?? 'Team lead'}</DetailLabel> : null}
                                                    </div>
                                                    {role.skills?.length ? <div className="mt-1.5"><SkillList skills={role.skills} size="sm" /></div> : null}
                                                </div>
                                            ))}
                                        </div>
                                    ) : <span className="text-muted-foreground">No open roles. People can follow it, but can’t apply.</span>}
                                </ReviewRow>
                            </>
                        )}
                    </ReviewSection>

                    <ReviewSection step={4} label={org ? 'Setup' : 'Settings'} line={lines[4]} open={isOpen(4)} onToggle={() => toggle(4)} onEdit={() => goToPhase(4)}>
                        {changedOnly && changedCount === 0 ? <p className="nb-rv-none">Nothing changed from the defaults.</p> : null}
                        {org && !changedOnly ? (
                            <ReviewRow label="Workspaces inside">
                                {org.child_creation === 'admins' ? 'Admins create workspaces' : 'All members create workspaces'}
                                {org.term_start || org.term_end ? ` · ${ORG_CREATION_COPY[org.org_type ?? 'other'].termLabel} ${org.term_start || '…'} to ${org.term_end || '…'}` : ''}
                                {org.plan_sprints ? ` · ${org.plan_sprints.count} sprints planned` : ''}
                            </ReviewRow>
                        ) : null}
                        {showSetting('picture') ? <ReviewRow label="Picture" tag={tag('picture')}>{projectImage ? `${projectImage.name} · uploads after it’s made` : 'A pixel picture until you add one.'}</ReviewRow> : null}
                        {showSetting('access') ? (
                            <ReviewRow label="Visibility" tag={tag('access')}>
                                {visibilityWord}
                                <p className="nb-rv-s">{formData.visibility === 'private' ? `Only members can see this ${noun}.` : `Tabs: ${publicTabLabels.join(' · ') || 'none'}.`}</p>
                            </ReviewRow>
                        ) : null}
                        {showSetting('links') ? (
                            <ReviewRow label="Links" tag={tag('links')}>
                                {projectLinks.length ? (
                                    <ul className="space-y-1.5">
                                        {projectLinks.map((link) => {
                                            const resolved = resolveSocialPresence(link.platform, link.url);
                                            const title = link.label || link.destinationLabel || resolved?.platformLabel || `${Noun} link`;
                                            return <li key={link.id} className="min-w-0 truncate">{title} <span className="text-muted-foreground">· {link.audience === 'members' ? 'Members only' : 'Public'}</span></li>;
                                        })}
                                    </ul>
                                ) : <span className="text-muted-foreground">No links.</span>}
                            </ReviewRow>
                        ) : null}
                        {showSetting('documentation') ? (
                            <ReviewRow label="Starter doc" tag={tag('documentation')}>
                                {docSkipped ? 'No documents yet.' : `Starter template, ${formData.readme?.publishOnCreate ? 'published when it’s made' : 'kept as a draft'}. ${formData.doc_edit_policy === 'members' ? 'Members can edit.' : 'The owner and admins edit.'}`}
                            </ReviewRow>
                        ) : null}
                        {!org && showSetting('lifecycle') ? <ReviewRow label="Stages" tag={tag('lifecycle')}>{lifecycleStages.length ? lifecycleStages.join(' → ') : 'No stages yet.'}</ReviewRow> : null}
                        {showSetting('permissions') ? (
                            <ReviewRow label="Permissions" tag={tag('permissions')}>
                                Updates: {memberUpdates ? 'members can post' : 'owner and admins only'} · New-member uploads: {memberUploads ? 'on' : 'off'}
                                {childOrg ? <p className="nb-rv-s">{formData.follow_org_sprints ? `Follows ${childOrg.title}’s sprints` : `Doesn’t follow ${childOrg.title}’s sprints`}</p> : null}
                            </ReviewRow>
                        ) : null}
                        {showSetting('files') ? <ReviewRow label="Files" tag={tag('files')}>{sourceLine}</ReviewRow> : null}
                        {showSetting('notifications') ? (
                            <ReviewRow label="Notifications" tag={tag('notifications')}>
                                {CREATE_WORKSPACE_NOTIFICATION_ROWS.map((row) => `${row.label}: ${notificationRows[row.id] ? 'on' : 'off'}`).join(' · ')}
                            </ReviewRow>
                        ) : null}
                    </ReviewSection>

                    {worth.length ? (
                        <section aria-labelledby="review-worth" className="nbs-frame">
                            <p id="review-worth" className="nbs-glabel pt-[18px]">Worth a look<span className="r"><span className="nbs-tag">Optional</span></span></p>
                            {worth.map(([label, line, step]) => (
                                <div key={label} className="nbs-row">
                                    <div className="min-w-0"><p className="t">{label}</p><p className="d">{line}</p></div>
                                    <div className="ctl"><button type="button" className="nb-link text-[13px]" onClick={() => goToPhase(step)}>Add</button></div>
                                </div>
                            ))}
                        </section>
                    ) : null}
                </div>

                <aside data-review-side aria-label="Check-up and preview" className="nb-review-side">
                    <section className="nbs-frame" aria-labelledby="review-checkup">
                        <p id="review-checkup" className="nbs-glabel pt-[18px]">Check-up<span className="r"><span className="font-mono text-[12px] tabular-nums text-muted-foreground">{doneCount} of {required.length} required</span></span></p>
                        <div className="nb-sq-row" aria-hidden="true">{required.map(([label, ok], i) => <span key={label} className="nb-sq" data-on={ok || undefined} style={{ ['--i' as string]: i }} />)}</div>
                        {doneCount === required.length ? (
                            <p className="nb-ready"><PixelTick className="text-[var(--status-success)]" draw /><span><b>Ready to create.</b> Everything else can change later in Settings.</span></p>
                        ) : required.filter(([, ok]) => !ok).map(([label, , step]) => (
                            <div key={label} className="nbs-row">
                                <p className="t">{label}</p>
                                <div className="ctl"><button type="button" className="nb-link text-[13px]" onClick={() => goToPhase(step)}>Fix</button></div>
                            </div>
                        ))}
                    </section>

                    <section className="nbs-frame" aria-labelledby="review-where">
                        <p id="review-where" className="nbs-glabel pt-[18px]">Where it shows</p>
                        <div className="nb-sbody">
                            {whereOptions.length > 1 ? (
                                <div className="nb-seg mb-3" data-size="sm" data-fill role="radiogroup" aria-label="Where it shows">
                                    {whereOptions.map((option) => <button key={option.id} type="button" role="radio" aria-checked={where === option.id} onClick={() => setWhere(option.id)}>{option.label}</button>)}
                                    <TabMarker />
                                </div>
                            ) : null}
                            <div className="pointer-events-none select-none" inert>
                                {where === 'search' ? (
                                    <div role="listbox" aria-label="Search preview" className="rounded-lg border border-border bg-card p-1.5">
                                        <WorkspaceSearchResultCard index={0} activeIndex={-1} onActivate={() => undefined} onOpen={() => undefined}
                                            result={{ kind: 'project', id: 'preview', title: formData.title || `Untitled ${noun}`, subtitle: formData.short_description || formData.description || '', href: '', matchReason: null,
                                                username: null, status: null, skills: formData.technologies_used || [], openRolesCount: openRoles.length, followersCount: 0, viewCount: 0,
                                                connectedFriends: [], additionalConnectedFriendsCount: 0, coverImage: previewCoverUrl }} />
                                    </div>
                                ) : <ProjectCard project={previewProject} titleChip={where === 'org' ? <span className="nbs-tag hot">New</span> : undefined} />}
                            </div>
                            <p className="mt-2.5 text-[12.5px] leading-[1.5] text-muted-foreground">
                                {formData.visibility === 'private' ? 'Only members see this card.' : where === 'search' ? 'As it shows in the search menu.' : where === 'org' ? `At the top of ${childOrg?.title}’s Workspaces tab.` : 'Exactly as it shows on Discover. “Updated by” appears after the first update.'}
                            </p>
                        </div>
                    </section>

                    <section className="nbs-frame" aria-labelledby="review-create">
                        <p id="review-create" className="nbs-glabel pt-[18px]">When you press Create</p>
                        <ol data-create-steps className="nb-create-steps">
                            {steps.map((step, i) => (
                                <li key={step.key}>
                                    <span className="nb-create-n">{pad(i + 1)}</span>
                                    <span className="min-w-0">{step.label}{step.count ? ` · ${step.count} ${step.unit}` : ''}</span>
                                    {step.background ? <span className="nbs-tag">keeps going if you leave</span> : step.keepTabOpen ? <span className="nbs-tag warn">keep this tab open</span> : <span />}
                                </li>
                            ))}
                        </ol>
                    </section>
                </aside>
            </div>
        </div>
    );
}
