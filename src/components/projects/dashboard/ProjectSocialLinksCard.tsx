'use client';

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Globe, Link2, Loader2, LockKeyhole, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/feedback';
import { updateProjectExternalLinksAction } from '@/app/actions/project';
import { SocialPresenceIcon } from '@/components/profile/SocialPresenceIcon';
import { SortableLinkList } from '@/components/links/SortableLinkList';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useOpenSettingsSections } from '@/components/settings/ui/SettingsSectionLayout';
import { fetchLinkPreview, useLinkPreview } from '@/hooks/useLinkPreview';
import { normalizeLinkDestinationTitle } from '@/lib/links/destination-title';
import {
    areProjectSocialLinksEqual,
    countProjectLinkChanges,
    extractProjectLinkUrls,
    hydrateProjectSocialLinks,
    inferProjectLinkPurpose,
    isProjectLinkMetadataStale,
    PROJECT_LINK_PURPOSE_LABELS,
    resolveProjectSocialLinks,
    type ProjectRepositoryContext,
    type ResolvedProjectSocialLink,
} from '@/lib/projects/social-links';
import {
    findSensitiveLinkParameters,
    PROJECT_LINK_PURPOSES,
    resolveSocialPresence,
    mergeSocialLinkCollections,
    socialLinkItemsFromStorage,
    type ProjectLinkAudience,
    type ProjectLinkMetadataRecord,
    type ProjectLinkPurpose,
    type SocialLinkItem,
    validateSocialLinkCollection,
} from '@/lib/profile/normalization';

type LinkHealth = ProjectLinkMetadataRecord;

export type ProjectLinkEditorHandle = {
    prepareForSave: () => Promise<{ success: true; links: SocialLinkItem[] } | { success: false }>;
};

function linkTitle(link: ResolvedProjectSocialLink) {
    return link.customLabel || link.platformLabel;
}

function ProjectLinkIcon({ link, className = 'h-4 w-4' }: { link: Pick<ResolvedProjectSocialLink, 'iconKey'>; className?: string }) {
    return link.iconKey
        ? <SocialPresenceIcon iconKey={link.iconKey} className={className} />
        : <Globe aria-hidden="true" className={className} />;
}

function linkHref(projectId: string, link: ResolvedProjectSocialLink) {
    return `/go/project/${encodeURIComponent(projectId)}/${encodeURIComponent(link.id || link.canonicalKey)}`;
}

function ProjectLinkAnchor({ projectId, link, className }: { projectId: string; link: ResolvedProjectSocialLink; className?: string }) {
    const title = linkTitle(link);
    const repoRoleLabel = link.repositoryRole === 'cloned' || link.managed === 'github-cloned-repo'
        ? ' · Imported from GitHub'
        : link.managed
            ? ' · Connected to GitHub'
            : '';
    const description = `${title} · ${link.accountLabel} · ${PROJECT_LINK_PURPOSE_LABELS[link.purpose]}${link.audience === 'members' ? ' · Members only' : ''}${repoRoleLabel}`;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <a
                    href={linkHref(projectId, link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${description}`}
                    className={cn('nb-icon-button h-7 w-7 shrink-0 rounded-[5px] text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className /* h-[var(--ui-control-height)] */)}
                >
                    <ProjectLinkIcon link={link} />
                </a>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>{description}</TooltipContent>
        </Tooltip>
    );
}

function ProjectLinkOverflow({ projectId, links, className, labelled = false }: { projectId: string; links: ResolvedProjectSocialLink[]; className?: string; labelled?: boolean }) {
    if (!links.length) return null;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={labelled ? `Open ${links.length} project link${links.length === 1 ? '' : 's'}` : `Open ${links.length} more project link${links.length === 1 ? '' : 's'}`}
                    className={cn('nb-touch-target inline-flex h-7 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-xs font-semibold text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
                >
                    {labelled ? <><Link2 className="h-3.5 w-3.5" />Links <span className="text-[11px] text-muted-foreground">{links.length}</span></> : `+${links.length}`}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                {links.map((link) => (
                    <DropdownMenuItem key={link.id || link.canonicalKey} asChild>
                        <a href={linkHref(projectId, link)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${linkTitle(link)}: ${link.accountLabel}`} className="min-w-0">
                            <ProjectLinkIcon link={link} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{linkTitle(link)}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                    {link.accountLabel} · {PROJECT_LINK_PURPOSE_LABELS[link.purpose]}{link.audience === 'members' ? ' · Members only' : ''}
                                </span>
                            </span>
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export const ProjectLinkEditorFields = forwardRef<ProjectLinkEditorHandle, {
    links: unknown;
    onChange: (links: SocialLinkItem[]) => void;
    savedLinks?: unknown;
    githubRepoUrl?: string | null;
    importSource?: { type?: string; repoUrl?: string; branch?: string } | null;
    githubSyncConnection?: { repository?: string; branch?: string } | null;
    health?: LinkHealth;
    projectType?: string | null;
    disabled?: boolean;
    onPendingChange?: (pending: boolean) => void;
    commitContext?: 'settings' | 'project-create';
}>(function ProjectLinkEditorFields({
    links,
    onChange,
    savedLinks,
    githubRepoUrl,
    importSource,
    githubSyncConnection,
    health = {},
    projectType,
    disabled = false,
    onPendingChange,
    commitContext = 'settings',
}, ref) {
    const openSections = useOpenSettingsSections();
    const draft = useMemo(() => hydrateProjectSocialLinks(links, health), [health, links]);
    const saved = useMemo(() => savedLinks === undefined ? null : socialLinkItemsFromStorage(savedLinks), [savedLinks]);
    const [url, setUrl] = useState('');
    const [customLabel, setCustomLabel] = useState('');
    const [destinationLabel, setDestinationLabel] = useState('');
    const [purpose, setPurpose] = useState<ProjectLinkPurpose | ''>('');
    const [audience, setAudience] = useState<ProjectLinkAudience>('public');
    const [metadataUrl, setMetadataUrl] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [identifyingIds, setIdentifyingIds] = useState<Set<string>>(() => new Set());
    const [duplicateId, setDuplicateId] = useState<string | null>(null);
    const draftRef = useRef(draft);
    const pendingTasksRef = useRef<Promise<void>[]>([]);
    const urlInputId = useId();
    const candidate = useMemo(() => url.trim()
        ? validateSocialLinkCollection([{ id: 'project-draft', platform: 'website', url: url.trim() }])
        : null, [url]);
    const previewItem = candidate?.success ? candidate.links[0] : null;
    const preview = previewItem ? resolveSocialPresence(previewItem.platform, previewItem.url) : null;
    const isCustomPreview = ['website', 'portfolio', 'other'].includes(preview?.platform || '');

    const repositoryContext = useMemo<ProjectRepositoryContext | null>(() => {
        if (importSource || githubSyncConnection) {
            return { importSource, githubSyncConnection };
        }
        return null;
    }, [importSource, githubSyncConnection]);

    const managedRepositories = useMemo(() => {
        if (repositoryContext) {
            return resolveProjectSocialLinks([], null, repositoryContext).filter(
                (link) => link.managed === 'github-sync-connection' || link.managed === 'github-cloned-repo',
            );
        }
        return resolveProjectSocialLinks([], githubRepoUrl).filter((link) => Boolean(link.managed));
    }, [githubRepoUrl, repositoryContext]);

    const previewUrl = preview?.url || null;
    useEffect(() => {
        if (!previewUrl) {
            setMetadataUrl(null);
            return;
        }
        const timeout = window.setTimeout(() => setMetadataUrl(previewUrl), 350);
        return () => window.clearTimeout(timeout);
    }, [previewUrl]);
    const metadataQuery = useLinkPreview(metadataUrl);
    const metadataTitle = metadataUrl === previewUrl
        ? normalizeLinkDestinationTitle(metadataQuery.data?.title, preview?.platform)
        : null;
    const effectiveDestinationLabel = destinationLabel.trim() || metadataTitle || '';
    const effectivePurpose = purpose || (preview ? inferProjectLinkPurpose(preview) : 'other');
    const metadataPending = Boolean(previewUrl) && (metadataUrl !== previewUrl || metadataQuery.isFetching);
    const sensitiveParameters = previewUrl ? findSensitiveLinkParameters(previewUrl) : [];
    const projectTypeHint = useMemo(() => {
        const normalized = String(projectType || '').toLowerCase();
        if (/research|academic|science/.test(normalized)) return 'Common for research: publications, datasets, source code, and demos.';
        if (/design|creative|portfolio/.test(normalized)) return 'Common for design: live product, prototypes, case studies, and research.';
        if (/mobile|app|software|developer|open.source/.test(normalized)) return 'Common for software: live product, source code, documentation, and distribution.';
        if (/community|social/.test(normalized)) return 'Common for communities: community, documentation, support, and live product.';
        return 'Organize by purpose so people can find the right destination even when the provider is unfamiliar.';
    }, [projectType]);

    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);

    const publishDraft = useCallback((next: SocialLinkItem[] | ((current: SocialLinkItem[]) => SocialLinkItem[])) => {
        const value = typeof next === 'function' ? next(draftRef.current) : next;
        draftRef.current = value;
        onChange(value);
        return value;
    }, [onChange]);

    const currentEditingItem = editingId ? draft.find((item) => item.id === editingId) : undefined;
    const composerPending = Boolean(url.trim())
        && (!currentEditingItem || currentEditingItem.url !== previewUrl);
    useEffect(() => onPendingChange?.(composerPending), [composerPending, onPendingChange]);

    const resetComposer = () => {
        setUrl('');
        setCustomLabel('');
        setDestinationLabel('');
        setPurpose('');
        setAudience('public');
        setMetadataUrl(null);
        setEditingId(null);
        setDuplicateId(null);
        setError(null);
    };

    const editItem = useCallback((item: SocialLinkItem) => {
        const link = resolveSocialPresence(item.platform, item.url);
        setEditingId(item.id);
        setUrl(item.url);
        setCustomLabel(item.label || '');
        setDestinationLabel(item.destinationLabel || '');
        setPurpose(item.purpose || (link ? inferProjectLinkPurpose(link) : 'other'));
        setAudience(item.audience === 'members' ? 'members' : 'public');
        setDuplicateId(null);
        setError(null);
    }, []);

    const updateEditingItem = useCallback((patch: Partial<SocialLinkItem>) => {
        if (!editingId) return;
        publishDraft((current) => current.map((item) => item.id === editingId ? { ...item, ...patch } : item));
    }, [editingId, publishDraft]);

    const enrichItems = useCallback((items: SocialLinkItem[]) => {
        if (!items.length) return;
        const ids = new Set(items.map((item) => item.id));
        setIdentifyingIds((current) => new Set([...current, ...ids]));
        const task = Promise.all(items.map(async (item) => ({ item, preview: await fetchLinkPreview(item.url) })))
            .then((results) => {
                publishDraft((current) => current.map((item) => {
                    const result = results.find((candidate) => candidate.item.id === item.id);
                    if (!result?.preview) return item;
                    const resolved = resolveSocialPresence(item.platform, item.url);
                    const title = normalizeLinkDestinationTitle(result.preview.title, resolved?.platform);
                    const keepManualName = item.metadata?.nameSource === 'manual' && Boolean(item.destinationLabel);
                    return {
                        ...item,
                        ...(!keepManualName && title ? { destinationLabel: title } : {}),
                        metadata: {
                            health: result.preview.health ?? 'unknown',
                            checkedAt: result.preview.checkedAt ?? new Date().toISOString(),
                            nameSource: keepManualName ? 'manual' : result.preview.titleSource ?? 'url',
                            fetchedAt: result.preview.checkedAt ?? new Date().toISOString(),
                            resolvedHost: result.preview.resolvedHost ?? result.preview.domain,
                            ...(result.preview.contentType ? { contentType: result.preview.contentType } : {}),
                        },
                    };
                }));
            })
            .finally(() => {
                setIdentifyingIds((current) => new Set([...current].filter((id) => !ids.has(id))));
                pendingTasksRef.current = pendingTasksRef.current.filter((pending) => pending !== task);
            });
        pendingTasksRef.current.push(task);
    }, [publishDraft]);

    const stageUrls = useCallback((rawUrls: string[], replaceId?: string | null) => {
        const current = draftRef.current;
        const additions: SocialLinkItem[] = [];
        let next = current;
        let firstProblem: string | null = null;
        let highlightedDuplicate: SocialLinkItem | undefined;

        for (const rawUrl of rawUrls) {
            const validation = validateSocialLinkCollection([{ id: replaceId && rawUrls.length === 1 ? replaceId : `link-${crypto.randomUUID()}`, platform: 'website', url: rawUrl }]);
            if (!validation.success || !validation.links[0]) {
                firstProblem ||= validation.success ? 'Enter a valid public web address.' : validation.error;
                continue;
            }
            const item = validation.links[0];
            const resolved = resolveSocialPresence(item.platform, item.url);
            if (!resolved) {
                firstProblem ||= 'Enter a valid public web address.';
                continue;
            }
            const duplicate = next.find((candidate) => candidate.id !== replaceId && candidate.url === resolved.url);
            if (duplicate) {
                highlightedDuplicate = duplicate;
                firstProblem ||= 'This project link is already present.';
                continue;
            }
            if (!replaceId && next.length >= 20) {
                firstProblem ||= 'Add no more than 20 links.';
                break;
            }

            const oneComposerLink = rawUrls.length === 1;
            const useComposerValues = oneComposerLink && previewUrl === resolved.url;
            const now = new Date().toISOString();
            const nextItem: SocialLinkItem = {
                ...item,
                ...(useComposerValues && isCustomPreview && customLabel.trim() ? { label: customLabel.trim() } : {}),
                ...(useComposerValues && effectiveDestinationLabel ? { destinationLabel: effectiveDestinationLabel } : {}),
                purpose: useComposerValues ? effectivePurpose : inferProjectLinkPurpose(resolved),
                audience: useComposerValues ? audience : 'public',
                metadata: {
                    health: useComposerValues ? metadataQuery.data?.health ?? 'unknown' : 'unknown',
                    checkedAt: useComposerValues ? metadataQuery.data?.checkedAt ?? now : now,
                    nameSource: useComposerValues && destinationLabel.trim() ? 'manual' : metadataQuery.data?.titleSource ?? 'url',
                    fetchedAt: useComposerValues ? metadataQuery.data?.checkedAt ?? now : now,
                    resolvedHost: useComposerValues ? metadataQuery.data?.resolvedHost ?? new URL(resolved.url).hostname : new URL(resolved.url).hostname,
                    ...(useComposerValues && metadataQuery.data?.contentType ? { contentType: metadataQuery.data.contentType } : {}),
                },
            };
            next = replaceId && rawUrls.length === 1
                ? next.map((candidate) => candidate.id === replaceId ? nextItem : candidate)
                : [...next, nextItem];
            additions.push(nextItem);
        }

        if (highlightedDuplicate) {
            editItem(highlightedDuplicate);
            setDuplicateId(highlightedDuplicate.id);
        }
        if (!additions.length) {
            setError(firstProblem || 'Enter a valid public web address.');
            return false;
        }
        const validated = validateSocialLinkCollection(next.map((item, order) => ({ ...item, order })));
        if (!validated.success) {
            setError(validated.error);
            return false;
        }
        publishDraft(validated.links);
        const first = validated.links.find((item) => item.id === additions[0]?.id);
        if (first) editItem(first);
        setError(firstProblem);
        enrichItems(additions);
        return true;
    }, [audience, customLabel, destinationLabel, editItem, effectiveDestinationLabel, effectivePurpose, enrichItems, isCustomPreview, metadataQuery.data, previewUrl, publishDraft]);

    const addOrUpdate = useCallback(() => {
        if (!url.trim()) return true;
        if (editingId && currentEditingItem?.url === previewUrl) return true;
        return stageUrls([url.trim()], editingId);
    }, [currentEditingItem?.url, editingId, previewUrl, stageUrls, url]);

    useImperativeHandle(ref, () => ({
        prepareForSave: async () => {
            if (!addOrUpdate()) return { success: false };
            await Promise.all([...pendingTasksRef.current]);
            return { success: true, links: draftRef.current };
        },
    }), [addOrUpdate]);

    const stageText = (value: string) => {
        const extracted = extractProjectLinkUrls(value);
        return stageUrls(extracted.length ? extracted : [value.trim()], editingId && extracted.length <= 1 ? editingId : null);
    };

    return (
        <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
            {managedRepositories.map((repo) => {
                const isCloned = repo.repositoryRole === 'cloned' || repo.managed === 'github-cloned-repo';
                const label = isCloned ? 'Imported from GitHub' : 'Connected to GitHub';
                const badgeText = isCloned ? 'Cloned from GitHub' : 'Managed by GitHub';
                const badgeClasses = isCloned
                    ? 'border border-border bg-muted/60 text-muted-foreground'
                    : 'border border-primary/20 bg-primary/10 text-primary';
                const subtitle = repo.branch && !isCloned
                    ? `${repo.accountLabel} · ${repo.branch}`
                    : repo.accountLabel;
                const isUnavailable = Boolean(repo.id && health[repo.id]?.health === 'unavailable') || health['github-integration']?.health === 'unavailable';

                return (
                    <div
                        key={repo.id}
                        data-testid={`project-managed-repo-${repo.id}`}
                        className={openSections ? "flex min-w-0 items-center gap-3 border-b border-border py-3" : "flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"}
                    >
                        <ProjectLinkIcon link={repo} className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                                {label}
                                {isUnavailable ? (
                                    <AlertTriangle
                                        aria-label="Repository was unavailable on its last open"
                                        className="h-3.5 w-3.5 shrink-0 text-amber-500"
                                    />
                                ) : null}
                            </span>
                            <span className="block truncate nb-compact text-muted-foreground">{subtitle}</span>
                        </span>
                        <span className={cn('hidden shrink-0 h-5 px-[7px] rounded-[3px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center sm:inline-flex', badgeClasses)}>
                            {badgeText}
                        </span>
                    </div>
                );
            })}

            {draft.length ? (
                <SortableLinkList
                    items={draft}
                    disabled={disabled}
                    className={openSections ? "min-w-0 max-w-full divide-y divide-border" : "min-w-0 max-w-full divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"}
                    itemClassName="flex min-w-0 max-w-full items-center gap-2.5 overflow-hidden bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/30"
                    handleClassName="-ml-1 text-muted-foreground hover:text-foreground"
                    getItemLabel={(item) => {
                        const link = resolveSocialPresence(item.platform, item.url);
                        return item.label || link?.platformLabel || 'project link';
                    }}
                    onReorder={(next) => publishDraft(next.map((item, order) => ({ ...item, order })))}
                >
                    {(item) => {
                        const link = resolveSocialPresence(item.platform, item.url);
                        if (!link) return null;
                        const title = item.label || link.platformLabel;
                        const unavailable = (item.metadata || health[item.id])?.health === 'unavailable';
                        const itemPurpose = item.purpose || inferProjectLinkPurpose(link);
                        const staleMetadata = isProjectLinkMetadataStale(item.metadata || health[item.id]);
                        const savedItem = saved?.find((candidate) => candidate.id === item.id);
                        const draftState = commitContext === 'settings' && saved
                            ? !savedItem ? 'New' : !areProjectSocialLinksEqual([savedItem], [item]) ? 'Edited' : null
                            : null;
                        const opaqueName = (link.platform === 'youtube' && ['watch', 'shorts', 'live'].includes(link.accountLabel.toLowerCase()))
                            || (link.platform === 'google-scholar' && ['scholar profile', 'publication'].includes(link.accountLabel.toLowerCase()));
                        return (
                            <>
                                <span className="shrink-0 text-muted-foreground"><ProjectLinkIcon link={link} /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5 truncate font-medium text-foreground">{title}{draftState ? <span className="inline-flex h-5 items-center rounded-[3px] border border-primary/20 bg-primary/10 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-primary">{draftState}</span> : null}{duplicateId === item.id ? <span className="inline-flex h-5 items-center rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-300">Already added</span> : null}{unavailable ? <AlertTriangle aria-label="Link is unavailable" className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : null}{item.audience === 'members' ? <LockKeyhole aria-label="Members only" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}</span>
                                    <span aria-live="polite" className={cn('flex items-center gap-1 truncate text-xs', opaqueName && !item.destinationLabel && !identifyingIds.has(item.id) ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
                                        {identifyingIds.has(item.id) ? <><RefreshCw className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" />Identifying destination…</> : item.destinationLabel || (opaqueName ? 'Name needed — you can add it manually' : link.accountLabel)}
                                    </span>
                                    <span className="mt-1 inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-muted-foreground">{PROJECT_LINK_PURPOSE_LABELS[itemPurpose]}</span>
                                    {staleMetadata ? <span className="ml-1 mt-1 inline-flex h-5 items-center rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-300">Name may be out of date</span> : null}
                                </span>
                                <button type="button" disabled={disabled} onClick={() => editItem(item)} className="nb-touch-target nb-icon-button inline-flex h-[28px] w-[28px] items-center justify-center rounded-[5px] border border-border/70 text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label={`Edit ${title}`}><Pencil className="h-3.5 w-3.5" /></button>
                                <button type="button" disabled={disabled} onClick={() => { publishDraft(draftRef.current.filter((row) => row.id !== item.id).map((row, order) => ({ ...row, order }))); if (editingId === item.id) resetComposer(); }} className="nb-touch-target nb-icon-button inline-flex h-[28px] w-[28px] items-center justify-center rounded-[5px] border border-border/70 text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" aria-label={`Remove ${title}`}><Trash2 className="h-3.5 w-3.5" /></button>
                            </>
                        );
                    }}
                </SortableLinkList>
            ) : null}

            <div
                className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-muted/20 p-4 sm:p-5"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    const text = event.dataTransfer.getData('text/plain');
                    if (!text) return;
                    event.preventDefault();
                    stageText(text);
                }}
            >
                <label htmlFor={urlInputId} className="nb-ui-label block text-foreground">{editingId ? 'Link destination' : draft.length ? 'Add another link' : 'Project link'}</label>
                <p className="mt-1 text-xs text-muted-foreground">
                    {commitContext === 'project-create'
                        ? 'Paste or drop one or several URLs. They are staged immediately and saved when you create the project.'
                        : 'Paste one or more links. They’re saved when you select Save changes.'}
                </p>
                <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Input
                        id={urlInputId}
                        value={url}
                        onChange={(event) => { setUrl(event.target.value); setDestinationLabel(''); setDuplicateId(null); setError(null); }}
                        onPaste={(event) => {
                            const text = event.clipboardData.getData('text');
                            const urls = extractProjectLinkUrls(text);
                            if (!urls.length && !text.trim()) return;
                            event.preventDefault();
                            stageText(text);
                        }}
                        onBlur={() => { if (composerPending) addOrUpdate(); }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                                event.preventDefault();
                                addOrUpdate();
                            }
                        }}
                        placeholder="Paste URLs here"
                        inputMode="url"
                        autoComplete="url"
                        disabled={disabled}
                        className="h-[34px] min-w-0 flex-1 rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                </div>
                {preview ? <p className="mt-2.5 break-words text-xs text-muted-foreground">Detected: <strong className="text-foreground">{preview.platformLabel}</strong> · {effectiveDestinationLabel || preview.accountLabel}</p> : null}
                {metadataUrl === previewUrl && metadataQuery.data?.description ? <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{metadataQuery.data.description}</p> : null}
                {preview ? (
                    <div className="mt-3 flex min-w-0 gap-2">
                        <Input value={destinationLabel} onChange={(event) => { const value = event.target.value; setDestinationLabel(value); updateEditingItem({ ...(value.trim() ? { destinationLabel: value } : { destinationLabel: undefined }), metadata: { ...(currentEditingItem?.metadata || { health: 'unknown' }), nameSource: 'manual' } }); setError(null); }} maxLength={160} placeholder={metadataPending ? 'Finding the destination name…' : metadataTitle || preview.accountLabel} aria-label="Destination name" disabled={disabled} className="h-[34px] min-w-0 flex-1 rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                        <Button type="button" variant="outline" size="icon" onClick={() => { if (currentEditingItem) enrichItems([currentEditingItem]); }} disabled={disabled || identifyingIds.has(editingId || '')} aria-label="Refresh destination name" className="nb-touch-target h-[34px] w-[34px] shrink-0 rounded-[5px] border border-border bg-card text-muted-foreground hover:text-foreground"><RefreshCw className={cn('h-4 w-4', identifyingIds.has(editingId || '') && 'animate-spin motion-reduce:animate-none')} /></Button>
                    </div>
                ) : null}
                {isCustomPreview ? <Input value={customLabel} onChange={(event) => { setCustomLabel(event.target.value); updateEditingItem({ label: event.target.value || undefined }); }} maxLength={80} placeholder="Display name (optional, e.g. Live app)" aria-label="Custom link display name" disabled={disabled} className="mt-3 h-[34px] rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /> : null}
                {preview ? (
                    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                        <label className="min-w-0 nb-ui-label block text-foreground">
                            Purpose
                            <select value={effectivePurpose} onChange={(event) => { const value = event.target.value as ProjectLinkPurpose; setPurpose(value); updateEditingItem({ purpose: value }); }} disabled={disabled} className="nb-touch-target mt-1.5 h-[34px] min-w-0 max-w-full w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring">
                                {PROJECT_LINK_PURPOSES.map((value) => <option key={value} value={value}>{PROJECT_LINK_PURPOSE_LABELS[value]}</option>)}
                            </select>
                        </label>
                        <label className="min-w-0 nb-ui-label block text-foreground">
                            Visibility
                            <select value={audience} onChange={(event) => { const value = event.target.value as ProjectLinkAudience; setAudience(value); updateEditingItem({ audience: value }); }} disabled={disabled} className="nb-touch-target mt-1.5 h-[34px] min-w-0 max-w-full w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring">
                                <option value="public">Public</option>
                                <option value="members">Project members only</option>
                            </select>
                        </label>
                    </div>
                ) : null}
                <p className="mt-3 break-words text-xs leading-5 text-muted-foreground">{projectTypeHint} Member-only hides the destination in NetworkBase; it does not change access on the external service.</p>
                {sensitiveParameters.length ? <p role="alert" className="mt-3 flex items-start gap-2 rounded-[5px] border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />This URL contains credential-like parameters ({sensitiveParameters.join(', ')}). Confirm it is safe to share before saving.</p> : null}
                {url.trim() && candidate?.success === false ? <p role="alert" className="mt-2 text-xs font-medium text-destructive">{candidate.error}</p> : null}
                {error ? <p role="alert" className="mt-2 text-xs font-medium text-destructive">{error}</p> : null}
                {editingId ? <Button type="button" variant="outline" size="sm" onClick={resetComposer} disabled={disabled} className="nb-touch-target mt-3 h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"><Plus className="mr-1.5 h-3.5 w-3.5" />Add another link</Button> : null}
            </div>
        </div>
    );
});

export function ProjectLinksManager({
    projectId,
    links,
    githubRepoUrl,
    importSource,
    githubSyncConnection,
    health,
    projectType,
    mode = 'dialog',
    open,
    onOpenChange,
    onSaved,
}: {
    projectId: string;
    links: unknown;
    githubRepoUrl?: string | null;
    importSource?: { type?: string; repoUrl?: string; branch?: string } | null;
    githubSyncConnection?: { repository?: string; branch?: string } | null;
    health?: LinkHealth;
    projectType?: string | null;
    mode?: 'dialog' | 'inline';
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSaved?: (links: SocialLinkItem[]) => void;
}) {
    const router = useRouter();
    const editorRef = useRef<ProjectLinkEditorHandle>(null);
    const [draft, setDraft] = useState<SocialLinkItem[]>(() => hydrateProjectSocialLinks(links, health ?? {}));
    const [baseline, setBaseline] = useState<SocialLinkItem[]>(() => socialLinkItemsFromStorage(links));
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [hasComposerDraft, setHasComposerDraft] = useState(false);
    const changeCount = countProjectLinkChanges(baseline, draft);
    const removedCount = baseline.filter((savedLink) => !draft.some((draftLink) => draftLink.id === savedLink.id)).length;
    const hasUnsavedChanges = changeCount > 0 || hasComposerDraft;

    useEffect(() => {
        if (mode === 'inline' && hasUnsavedChanges) return;
        if (mode === 'inline' || open) {
            const next = hydrateProjectSocialLinks(links, health ?? {});
            setDraft(next);
            setBaseline(next);
        }
    }, [health, links, mode, open]);

    const save = async () => {
        if (saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            const prepared = await editorRef.current?.prepareForSave();
            if (prepared && !prepared.success) return;
            const linksToSave = prepared?.links ?? draft;
            const result = await updateProjectExternalLinksAction(projectId, linksToSave, baseline);
            if (!result.success) {
                if ('conflict' in result && result.conflict) {
                    const current = socialLinkItemsFromStorage(result.currentData);
                    setDraft(mergeSocialLinkCollections(baseline, draft, current));
                    setBaseline(current);
                }
                setSaveError(result.error);
                return;
            }
            const saved = hydrateProjectSocialLinks(result.data, result.metadata ?? {});
            setDraft(saved);
            setBaseline(saved);
            setHasComposerDraft(false);
            onSaved?.(saved);
            onOpenChange?.(false);
            router.refresh();
            toast.success('Workspace links saved');
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Couldn’t save project links. Your changes are retained.');
        } finally {
            setSaving(false);
        }
    };

    const requestOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && hasUnsavedChanges && !window.confirm('Discard your unsaved project link changes?')) return;
        onOpenChange?.(nextOpen);
    };

    const content = (
        <div
            className="min-w-0 max-w-full space-y-4 overflow-x-hidden"
            onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void save();
                }
            }}
        >
            <ProjectLinkEditorFields
                ref={editorRef}
                links={draft}
                savedLinks={baseline}
                onChange={setDraft}
                onPendingChange={setHasComposerDraft}
                githubRepoUrl={githubRepoUrl}
                importSource={importSource}
                githubSyncConnection={githubSyncConnection}
                health={health}
                projectType={projectType}
                disabled={saving}
            />
            {saveError ? <p role="alert" className="break-words text-sm text-destructive">{saveError}</p> : null}
        </div>
    );

    if (mode === 'inline') {
        return (
            <div>
                <div className="space-y-4">
                    {content}
                </div>
                <div className="mt-6 flex flex-col gap-3 border-t border-border py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="nb-compact text-muted-foreground">
                        {hasUnsavedChanges
                            ? `You have unsaved changes in project links (${changeCount + (hasComposerDraft ? 1 : 0)} pending).`
                            : "All project links are saved."}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setDraft(baseline);
                                setHasComposerDraft(false);
                            }}
                            disabled={saving || !hasUnsavedChanges}
                            className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => void save()}
                            disabled={saving || !hasUnsavedChanges}
                            className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                    Saving…
                                </>
                            ) : (
                                'Save changes'
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Dialog open={open} onOpenChange={requestOpenChange}>
            <DialogContent className="max-h-[min(90dvh,48rem)] w-[calc(100vw-1rem)] min-w-0 max-w-2xl overflow-x-hidden overflow-y-auto p-4 sm:w-[calc(100vw-2rem)] sm:p-6">
                <DialogHeader className="min-w-0">
                    <DialogTitle>Project links</DialogTitle>
                    <DialogDescription>Add the destinations people need. Services and icons are detected from each URL.</DialogDescription>
                </DialogHeader>
                {content}
                <DialogFooter className="sticky -bottom-4 -mx-4 min-w-0 border-t border-border bg-card px-4 pb-0 pt-3 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
                    <p className="mr-auto self-center nb-compact text-muted-foreground">{draft.length} {draft.length === 1 ? 'link' : 'links'} · {changeCount + (hasComposerDraft ? 1 : 0)} unsaved{removedCount ? ` · ${removedCount} removed` : ''}</p>
                    <Button type="button" variant="outline" onClick={() => requestOpenChange(false)} disabled={saving} className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted">Cancel</Button>
                    <Button type="button" onClick={() => void save()} disabled={saving || !hasUnsavedChanges} className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]">
                        {saving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving…
                            </>
                        ) : (
                            'Save changes'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function ProjectLinkCluster({
    projectId,
    links,
    githubRepoUrl,
    importSource,
    githubSyncConnection,
    health,
    projectType,
    canManage = false,
}: {
    projectId: string;
    links: unknown;
    githubRepoUrl?: string | null;
    importSource?: { type?: string; repoUrl?: string; branch?: string } | null;
    githubSyncConnection?: { repository?: string; branch?: string } | null;
    health?: LinkHealth;
    projectType?: string | null;
    canManage?: boolean;
}) {
    const [editorOpen, setEditorOpen] = useState(false);
    const [savedLinks, setSavedLinks] = useState<SocialLinkItem[]>(() => socialLinkItemsFromStorage(links));
    useEffect(() => setSavedLinks(socialLinkItemsFromStorage(links)), [links]);

    const repositoryContext = useMemo<ProjectRepositoryContext | null>(() => {
        if (importSource || githubSyncConnection) {
            return { importSource, githubSyncConnection };
        }
        return null;
    }, [importSource, githubSyncConnection]);

    const resolved = useMemo(() => {
        return resolveProjectSocialLinks(savedLinks, githubRepoUrl, repositoryContext);
    }, [savedLinks, githubRepoUrl, repositoryContext]);

    if (!resolved.length && !canManage) return null;
    return (
        <TooltipProvider>
            <div className="flex shrink-0 items-center gap-0.5" aria-label="Project links">
                {resolved.slice(0, 5).map((link, index) => (
                    <ProjectLinkAnchor
                        key={link.id || link.canonicalKey}
                        projectId={projectId}
                        link={link}
                        className={cn('hidden sm:inline-flex', index >= 3 && 'sm:hidden lg:inline-flex')}
                    />
                ))}
                <ProjectLinkOverflow projectId={projectId} links={resolved} labelled className="sm:hidden" />
                <ProjectLinkOverflow projectId={projectId} links={resolved.slice(3)} className="hidden sm:block lg:hidden" />
                <ProjectLinkOverflow projectId={projectId} links={resolved.slice(5)} className="hidden lg:block" />
                {canManage ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button type="button" onClick={() => setEditorOpen(true)} aria-label="Manage project links" className="nb-touch-target nb-icon-button h-7 w-7 shrink-0 rounded-[5px] text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <Plus className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>{resolved.length ? 'Manage project links' : 'Add project link'}</TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            {canManage && editorOpen ? <ProjectLinksManager projectId={projectId} links={savedLinks} githubRepoUrl={githubRepoUrl} importSource={importSource} githubSyncConnection={githubSyncConnection} health={health} projectType={projectType} open={editorOpen} onOpenChange={setEditorOpen} onSaved={setSavedLinks} /> : null}
        </TooltipProvider>
    );
}
