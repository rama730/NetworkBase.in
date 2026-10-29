'use client';

import { useCreateLocation, WherePicker } from '@/components/organizations/CreateLocation';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useFormContext } from 'react-hook-form';
import { Check, ChevronDown, ChevronRight, CircleHelp, File, Folder, FolderUp, GitBranch, Github, Loader2, RefreshCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast, feedbackError } from "@/lib/feedback";
import type { CreateProjectInput } from '@/lib/validations/project';
import { logger } from '@/lib/logger';
import { getAuthHardeningPhase } from '@/lib/auth/hardening';
import { buildOAuthRedirectTo, resolveAuthBaseUrl } from '@/lib/auth/redirects';
import { continueBrowserOAuthRedirect } from '@/lib/auth/oauth';
import {
    fetchGithubImportAccessState,
    fetchGithubImportAnalysis,
    fetchGithubImportBranches,
    fetchGithubImportPreflight,
    fetchGithubImportRepositories,
} from '@/lib/github/import-client';
import type { GithubImportRepoItem } from '@/lib/github/import-types';
import { areSealedImportTokensEqual, getSealedImportTokenFingerprint } from '@/lib/github/import-token-state';
import { SkillList } from '@/components/skills/SkillList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Phase1SourceMethodGroup, type ProjectSourceType, type StartingPoint } from '@/components/projects/create-wizard/phase1/Phase1SourceMethodGroup';
import type { OrgType } from '@/lib/organizations/config';
import { OrgTypePicker } from '@/components/organizations/OrgWizardFields';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { buildUploadManifest, type UploadManifest } from '@/components/projects/create-wizard/phase1/upload-manifest';
import { clearGithubOAuthResume, getCreateProjectReturnPath, saveGithubOAuthResume } from '@/components/projects/create-wizard/github-oauth-resume';
import { isGithubAccessRefreshError } from '@/components/projects/create-wizard/phase1/github-access';
import { normalizeGithubRepoUrl } from '@/lib/github/repo-validation';

const UploadManifestPreview = dynamic(() => import('@/components/projects/create-wizard/phase1/UploadManifestPreview').then((mod) => mod.UploadManifestPreview));
const GithubImportDetails = dynamic(() => import('@/components/projects/create-wizard/phase1/GithubImportDetails').then((mod) => mod.GithubImportDetails));

type SourceType = ProjectSourceType;

type GithubPreviewEntry = {
    name: string;
    path: string;
    type: 'file' | 'dir';
    size?: number | null;
    excludedReason?: 'ignored' | 'tooLarge';
};

type ImportSourceMetadata = Record<string, unknown> & {
    githubInstallationId?: number | null;
    githubPreflightStatus?: 'idle' | 'ok' | 'error';
    githubPreflightError?: string | null;
    githubPreflightWarnings?: string[];
    githubDescription?: string | null;
    githubUpdatedAt?: string | null;
    githubSizeKb?: number | null;
    importAuth?: unknown;
    fileCount?: number;
};

const GITHUB_OAUTH_RETRY_DELAYS_MS = [250, 500, 1000, 1500];
const TREE_INDENT_CLASSES = ['pl-2', 'pl-5', 'pl-8', 'pl-11', 'pl-14', 'pl-16'];

export default function Phase1SourceSelection({
    uploadFiles,
    setUploadFiles,
    githubPreview,
    githubFolderEntries,
    loadGithubFolder,
    startGithubRootPreview,
    initialSource = null,
    onSourceChange,
    isResumingGithubOAuth = false,
}: {
    uploadFiles: FileList | null;
    setUploadFiles: (files: FileList | null) => void;
    githubPreview: {
        status: 'idle' | 'loading' | 'ready' | 'error';
        repoUrl: string;
        branch: string | null;
        rootEntries: GithubPreviewEntry[];
        errorMessage: string | null;
    };
    githubFolderEntries: Record<string, GithubPreviewEntry[]>;
    loadGithubFolder: (folderPath: string) => Promise<void>;
    startGithubRootPreview: (repoUrl: string, branch?: string | null) => Promise<void>;
    initialSource?: SourceType | null;
    onSourceChange?: (source: SourceType | null) => void;
    isResumingGithubOAuth?: boolean;
}) {
    const { getValues, setValue, watch, getFieldState } = useFormContext<CreateProjectInput>();
    const importSourceType = watch('import_source.type') as SourceType | undefined;
    const repoUrl = watch('import_source.repoUrl');
    const branch = watch('import_source.branch');

    const supabase = createClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const latestBranchRequestKeyRef = useRef('');
    const latestPreflightRequestKeyRef = useRef('');
    const latestRepoAnalysisKeyRef = useRef('');
    const uploadAnalysisControllerRef = useRef<AbortController | null>(null);
    const uploadAnalysisSequenceRef = useRef(0);

    const [activeSourceView, setActiveSourceView] = useState<SourceType>(() => {
        if (initialSource) {
            return initialSource;
        }
        const currentImportSource = getValues('import_source');
        const metadata = (currentImportSource?.metadata || {}) as ImportSourceMetadata;
        if (currentImportSource?.type === 'github' && ((currentImportSource.repoUrl || '').trim() || metadata.importAuth)) {
            return 'github';
        }
        if (currentImportSource?.type === 'upload' && ((currentImportSource.s3Key || '').trim() || metadata.fileCount)) {
            return 'upload';
        }
        return currentImportSource?.type ?? 'scratch';
    });
    const [isAnalyzingGithub, setIsAnalyzingGithub] = useState(false);
    const [githubAnalysisResult, setGithubAnalysisResult] = useState<{
        title: string;
        description: string;
        technologies: string[];
    } | null>(null);
    const [isAnalyzingUpload, setIsAnalyzingUpload] = useState(false);
    const [uploadAnalysisResult, setUploadAnalysisResult] = useState<{
        title: string;
        description: string;
        technologies: string[];
    } | null>(null);
    const [uploadAnalysisError, setUploadAnalysisError] = useState<string | null>(null);
    const [uploadManifest, setUploadManifest] = useState<UploadManifest | null>(() =>
        uploadFiles?.length ? buildUploadManifest(uploadFiles) : null
    );

    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
    const [loadingFolders, setLoadingFolders] = useState<Set<string>>(() => new Set());

    const [hasGithubIdentity, setHasGithubIdentity] = useState(false);
    const [hasGithubRepoAccess, setHasGithubRepoAccess] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [ghUsername, setGhUsername] = useState<string | null>(null);
    const [githubAccountUnavailable, setGithubAccountUnavailable] = useState(false);

    const [repoPickerOpen, setRepoPickerOpen] = useState(false);
    const [repoQuery, setRepoQuery] = useState('');
    const [repoItems, setRepoItems] = useState<GithubImportRepoItem[]>([]);
    const [repoCursor, setRepoCursor] = useState<string | null>(null);
    const [isLoadingRepos, setIsLoadingRepos] = useState(false);
    const [repoLoadError, setRepoLoadError] = useState<string | null>(null);
    const [repoLoadedOnce, setRepoLoadedOnce] = useState(false);
    const [githubEntryMode, setGithubEntryMode] = useState<'paste' | 'browse'>('paste');
    const [showManualGithubEntry, setShowManualGithubEntry] = useState(false);
    const [isEditingResolvedRepo, setIsEditingResolvedRepo] = useState(false);
    const [branchOptions, setBranchOptions] = useState<string[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [isDragOverUpload, setIsDragOverUpload] = useState(false);
    const [isConnectingGithub, setIsConnectingGithub] = useState(isResumingGithubOAuth);
    const [repoRefreshRequired, setRepoRefreshRequired] = useState(false);
    const [preflightState, setPreflightState] = useState<{
        status: 'idle' | 'loading' | 'ok' | 'error';
        warnings: string[];
        error: string | null;
        authSource: string | null;
    }>({
        status: 'idle',
        warnings: [],
        error: null,
        authSource: null,
    });

    const selectedSource: SourceType = activeSourceView ?? importSourceType ?? 'scratch';
    // An organization is an empty project underneath (import_source stays scratch); this marks the choice.
    const organization = watch('organization');
    const location = useCreateLocation();

    useEffect(() => {
        onSourceChange?.(activeSourceView);
    }, [activeSourceView, onSourceChange]);

    useEffect(() => {
        if (githubEntryMode === 'browse' && !hasGithubRepoAccess) {
            setGithubEntryMode('paste');
        }
    }, [githubEntryMode, hasGithubRepoAccess]);

    const normalizeGitHubRepoUrl = useCallback((raw: string) => {
        return normalizeGithubRepoUrl(raw) ?? (raw || '').trim();
    }, []);

    const importSourceMetadata = (watch('import_source.metadata') || {}) as ImportSourceMetadata;

    const mergeImportSourceMetadata = useCallback((updates: Record<string, unknown>, shouldDirty: boolean = true) => {
        const current = ((getValues('import_source.metadata') || {}) as ImportSourceMetadata);
        let hasChanges = false;
        for (const [key, value] of Object.entries(updates)) {
            const currentValue = current[key as keyof ImportSourceMetadata];
            const isEqual =
                key === 'importAuth'
                    ? areSealedImportTokensEqual(currentValue, value)
                    : currentValue === value;
            if (!isEqual) {
                hasChanges = true;
                break;
            }
        }
        if (!hasChanges) {
            return;
        }
        setValue(
            'import_source.metadata',
            {
                ...current,
                ...updates,
            },
            { shouldDirty }
        );
    }, [getValues, setValue]);

    const sealedImportToken = importSourceMetadata.importAuth ?? null;
    const sealedImportTokenFingerprint = getSealedImportTokenFingerprint(sealedImportToken);

    useEffect(() => {
        if (!initialSource) return;
        const currentImportSource = getValues('import_source');
        const currentMetadata = (currentImportSource?.metadata || {}) as ImportSourceMetadata;
        setValue(
            'import_source',
            {
                ...(currentImportSource || {}),
                type: initialSource,
                metadata: currentMetadata,
            },
            { shouldDirty: false, shouldValidate: true }
        );
        setActiveSourceView(initialSource);
        if (initialSource === 'github') setShowManualGithubEntry(true);
    }, [getValues, initialSource, setValue]);

    useEffect(() => {
        if (importSourceType && importSourceType !== activeSourceView) {
            setActiveSourceView(importSourceType);
        }
    }, [activeSourceView, importSourceType]);

    useEffect(() => {
        if (activeSourceView !== 'github') {
            setIsLoadingAuth(false);
            return;
        }
        let cancelled = false;

        const scheduleRetry = (nextAttempt: number) => {
            const delayMs = GITHUB_OAUTH_RETRY_DELAYS_MS[nextAttempt - 1];
            if (!delayMs) return false;
            window.setTimeout(() => {
                if (!cancelled) {
                    void checkConnection(nextAttempt);
                }
            }, delayMs);
            return true;
        };

        const checkConnection = async (attempt: number = 0) => {
            let willRetry = false;
            try {
                const result = await fetchGithubImportAccessState();
                if (cancelled) return;
                const oauthPending = isResumingGithubOAuth;
                const shouldRetryPendingOAuth =
                    oauthPending
                    && attempt < GITHUB_OAUTH_RETRY_DELAYS_MS.length
                    && (!result.success || (result.linked && !result.repoAccess));
                if (shouldRetryPendingOAuth) {
                    willRetry = scheduleRetry(attempt + 1);
                    if (willRetry) return;
                }
                if (!result.success) {
                    setHasGithubIdentity(false);
                    setHasGithubRepoAccess(Boolean(sealedImportTokenFingerprint));
                    setGhUsername(null);
                    setRepoRefreshRequired(false);
                    setGithubAccountUnavailable(false);
                    setIsConnectingGithub(false);
                    return;
                }
                setHasGithubIdentity(result.linked);
                setHasGithubRepoAccess(result.repoAccess);
                setRepoRefreshRequired(result.refreshRequired);
                setGhUsername(result.username);
                setGithubAccountUnavailable(result.accountHealth.state === 'unavailable');
                setIsConnectingGithub(false);
                if (result.sealedImportToken && !areSealedImportTokensEqual(result.sealedImportToken, sealedImportToken)) {
                    mergeImportSourceMetadata({ importAuth: result.sealedImportToken }, false);
                }
            } catch (error) {
                if (cancelled) return;
                if (isResumingGithubOAuth && attempt < GITHUB_OAUTH_RETRY_DELAYS_MS.length) {
                    willRetry = scheduleRetry(attempt + 1);
                    if (willRetry) return;
                }
                console.error('Failed to check GitHub connection', error);
                setHasGithubIdentity(false);
                setHasGithubRepoAccess(Boolean(sealedImportTokenFingerprint));
                setGhUsername(null);
                setRepoRefreshRequired(false);
                setGithubAccountUnavailable(false);
                setIsConnectingGithub(false);
            } finally {
                if (!cancelled && !willRetry) {
                    setIsLoadingAuth(false);
                }
            }
        };

        setIsLoadingAuth(true);
        void checkConnection();

        return () => {
            cancelled = true;
        };
    }, [activeSourceView, isResumingGithubOAuth, mergeImportSourceMetadata, sealedImportTokenFingerprint]);

    const handleConnectGithub = async () => {
        let resumeId: string | undefined;
        try {
            setIsConnectingGithub(true);
            const returnUrl = new URL(window.location.href);
            const resume = saveGithubOAuthResume(getValues(), getCreateProjectReturnPath(returnUrl));
            if (!resume) {
                throw new Error('Your workspace setup could not be saved before connecting GitHub. Allow session storage and try again.');
            }
            resumeId = resume.id;
            returnUrl.searchParams.set('createProject', '1');
            returnUrl.searchParams.set('createProjectSource', 'github');
            const currentPath = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
            const oauthRequestId =
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `wizard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const redirectTo = buildOAuthRedirectTo(resolveAuthBaseUrl(), currentPath, oauthRequestId, 'github');
            logger.metric('auth.oauth.start', {
                requestId: oauthRequestId,
                provider: 'github',
                flow: 'create_wizard',
                nextPath: currentPath,
                phase: getAuthHardeningPhase(),
            });

            const result = await supabase.auth.signInWithOAuth({
                provider: 'github',
                options: {
                    redirectTo,
                    scopes: 'repo',
                },
            });
            if (result.error) throw result.error;
            if (!result.data?.url) {
                throw new Error('GitHub login redirect could not be started.');
            }
            continueBrowserOAuthRedirect(result);
        } catch (error: any) {
            setIsConnectingGithub(false);
            clearGithubOAuthResume(resumeId);
            toast.error(feedbackError(`Couldn’t connect GitHub: ${error?.message || 'Unknown error'}`, "Unknown error"));
        }
    };

    const handleSelectSource = (type: SourceType) => {
        const currentImportSource = getValues('import_source');
        if (type === 'scratch') {
            setValue(
                'import_source',
                {
                    type: 'scratch',
                    repoUrl: undefined,
                    branch: undefined,
                    s3Key: undefined,
                    metadata: {},
                },
                { shouldValidate: true, shouldDirty: true }
            );
        } else if (type === 'github') {
            setValue(
                'import_source',
                {
                    type: 'github',
                    repoUrl: currentImportSource?.type === 'github' ? currentImportSource.repoUrl : '',
                    branch: currentImportSource?.type === 'github' ? currentImportSource.branch : undefined,
                    s3Key: undefined,
                    metadata: currentImportSource?.type === 'github' ? (currentImportSource.metadata || {}) : {},
                },
                { shouldValidate: true, shouldDirty: true }
            );
        } else if (type === 'upload') {
            setValue(
                'import_source',
                {
                    type: 'upload',
                    repoUrl: undefined,
                    branch: undefined,
                    s3Key: currentImportSource?.type === 'upload' ? currentImportSource.s3Key : undefined,
                    metadata: currentImportSource?.type === 'upload' ? (currentImportSource.metadata || {}) : {},
                },
                { shouldValidate: true, shouldDirty: true }
            );
        }
        setActiveSourceView(type);
        if (type === 'github') {
            setShowManualGithubEntry(true);
        } else {
            setRepoPickerOpen(false);
        }
    };

    const handleSelectStartingPoint = (type: StartingPoint) => {
        if (type === 'organization') {
            handleSelectSource('scratch');
            if (!getValues('organization')) {
                // No type is picked for you (decision 175): the type cards start empty and Continue waits.
                setValue('organization', { org_type: undefined as unknown as OrgType, handle: '', join_mode: 'instant', child_creation: 'members', outside_people: false }, { shouldDirty: true });
                // An org's category is its Subject label (decision 180); member uploads to the org tree start off;
                // the starter doc starts off (report §34.5).
                setValue('project_type', 'organization');
                setValue('member_file_upload_default', false);
                setValue('readme', { ...getValues('readme'), mode: 'skip', publishOnCreate: false });
            }
            return;
        }
        const org = getValues('organization');
        if (org) {
            // Report §34.9: the shared text stays; org-only fields go after a confirm.
            const typed = Boolean(org.part_of || org.location || org.welcome_note || org.invite_emails?.trim() || org.co_admins?.length || getFieldState('organization.handle').isDirty);
            if (typed && !window.confirm('Switch to a workspace? Organization details like the handle and invites will be removed.')) return;
            setValue('organization', undefined, { shouldDirty: true });
            if (getValues('project_type') === 'organization') setValue('project_type', '');
            setValue('member_file_upload_default', true);
            setValue('member_updates_enabled', true);
            setValue('readme', { ...getValues('readme'), mode: 'starter' });
        }
        handleSelectSource(type);
    };

    const loadRepositories = useCallback(async (reset: boolean, cursorOverride?: string | null) => {
        if (!hasGithubRepoAccess) return;
        setIsLoadingRepos(true);
        setRepoLoadError(null);
        try {
            const result = await fetchGithubImportRepositories({
                cursor: reset ? null : (cursorOverride ?? null),
                q: repoQuery || null,
                perPage: 15,
            });
            setRepoItems((prev) => (reset ? result.items : [...prev, ...result.items]));
            setRepoCursor(result.cursor || null);
            setRepoLoadedOnce(true);
            setRepoLoadError(null);
            setRepoRefreshRequired(false);
            setHasGithubRepoAccess(true);
        } catch (error: any) {
            const message = error?.message || 'Couldn’t load repositories';
            setRepoLoadError(message);
            const needsRefresh = hasGithubIdentity && isGithubAccessRefreshError(message);
            setRepoRefreshRequired(needsRefresh);
            if (needsRefresh) {
                setHasGithubRepoAccess(false);
            }
            toast.error(feedbackError(message, "Action couldn’t finish"));
        } finally {
            setIsLoadingRepos(false);
        }
    }, [hasGithubIdentity, hasGithubRepoAccess, repoQuery]);

    const loadBranchesForRepo = useCallback(async (url: string) => {
        const normalizedUrl = normalizeGitHubRepoUrl(url || '');
        if (!normalizedUrl) return;

        latestBranchRequestKeyRef.current = normalizedUrl;
        setIsLoadingBranches(true);
        try {
            const installationId = importSourceMetadata.githubInstallationId ?? null;
            const result = await fetchGithubImportBranches({
                repoUrl: normalizedUrl,
                installationId,
            });
            if (latestBranchRequestKeyRef.current !== normalizedUrl) return;
            const options = Array.isArray(result.branches) ? result.branches : [];
            setBranchOptions(options);
            if (result.installationId) {
                mergeImportSourceMetadata({ githubInstallationId: result.installationId });
            }
            const currentBranch = (getValues('import_source.branch') || '').trim();
            if (options.length > 0 && (!currentBranch || !options.includes(currentBranch))) {
                setValue('import_source.branch', options[0], { shouldDirty: true });
            }
            setRepoRefreshRequired(false);
            setHasGithubRepoAccess(true);
        } catch (error: any) {
            if (latestBranchRequestKeyRef.current !== normalizedUrl) return;
            setBranchOptions([]);
            const needsRefresh = hasGithubIdentity && isGithubAccessRefreshError(error?.message);
            setRepoRefreshRequired(needsRefresh);
            if (needsRefresh) {
                setHasGithubRepoAccess(false);
            }
        } finally {
            if (latestBranchRequestKeyRef.current === normalizedUrl) {
                setIsLoadingBranches(false);
            }
        }
    }, [getValues, hasGithubIdentity, importSourceMetadata.githubInstallationId, mergeImportSourceMetadata, normalizeGitHubRepoUrl, setValue]);

    const runRepoAnalysis = useCallback(async (nextRepoUrl: string, installationId?: number | null) => {
        const normalizedUrl = normalizeGitHubRepoUrl(nextRepoUrl || '');
        if (!normalizedUrl) {
            setGithubAnalysisResult(null);
            return;
        }

        latestRepoAnalysisKeyRef.current = normalizedUrl;
        setIsAnalyzingGithub(true);
        try {
            const response = await fetchGithubImportAnalysis({
                repoUrl: normalizedUrl,
                installationId: installationId ?? importSourceMetadata.githubInstallationId ?? null,
            });
            if (latestRepoAnalysisKeyRef.current !== normalizedUrl) return;
            const result = response.result;
            if (!result) {
                setGithubAnalysisResult(null);
                return;
            }
            setGithubAnalysisResult(result);
            if (result.title && !getValues('title')?.trim()) {
                setValue('title', result.title, { shouldDirty: true });
            }
            if (result.description && !getValues('description')?.trim()) {
                setValue('description', result.description, { shouldDirty: true });
            }
            if (result.technologies.length > 0 && (getValues('technologies_used')?.length ?? 0) === 0) {
                setValue('technologies_used', result.technologies, { shouldDirty: true });
            }
        } catch (error: any) {
            if (error?.name !== 'AbortError' && latestRepoAnalysisKeyRef.current === normalizedUrl) {
                console.error('Failed to analyze repository', error);
            }
        } finally {
            if (latestRepoAnalysisKeyRef.current === normalizedUrl) {
                setIsAnalyzingGithub(false);
            }
        }
    }, [getValues, importSourceMetadata.githubInstallationId, normalizeGitHubRepoUrl, setValue]);

    const runPreflightChecks = useCallback(async (nextRepoUrl?: string, nextBranch?: string | null) => {
        const normalizedUrl = normalizeGitHubRepoUrl(nextRepoUrl || repoUrl || '');
        const requestedBranch = nextBranch ?? branch ?? null;
        const requestKey = `${normalizedUrl}#${requestedBranch || ''}`;
        latestPreflightRequestKeyRef.current = requestKey;

        if (!normalizedUrl) {
            setPreflightState({
                status: 'error',
                warnings: [],
                error: 'Enter a valid GitHub repository URL.',
                authSource: null,
            });
            mergeImportSourceMetadata({
                githubPreflightStatus: 'error',
                githubPreflightError: 'Enter a valid GitHub repository URL.',
                githubPreflightCheckedAt: new Date().toISOString(),
            });
            return false;
        }

        setPreflightState({ status: 'loading', warnings: [], error: null, authSource: null });
        try {
            const installationId = importSourceMetadata.githubInstallationId ?? null;
            const result = await fetchGithubImportPreflight({
                repoUrl: normalizedUrl,
                branch: requestedBranch,
                installationId,
            });
            if (latestPreflightRequestKeyRef.current !== requestKey) return false;
            const [repoOwner = null, repoName = null] = result.repo.fullName.split('/');

            setValue('import_source.repoUrl', result.normalizedRepoUrl, { shouldDirty: true });
            if (result.branch) {
                setValue('import_source.branch', result.branch, { shouldDirty: true });
            }
            mergeImportSourceMetadata({
                ...result.metadata,
                githubRepoId: result.repo.id,
                githubOwner: repoOwner,
                githubName: repoName,
                githubVisibility: result.repo.visibility,
                githubSizeKb: result.repo.sizeKb,
                githubInstallationId: result.auth.installationId,
                githubPreflightStatus: 'ok',
                githubPreflightWarnings: result.warnings,
                githubPreflightError: null,
                githubPreflightCheckedAt: result.checkedAt,
            });
            setPreflightState({
                status: 'ok',
                warnings: result.warnings,
                error: null,
                authSource: result.auth.source,
            });
            await loadBranchesForRepo(result.normalizedRepoUrl);
            await runRepoAnalysis(result.normalizedRepoUrl, result.auth.installationId);
            return true;
        } catch (error: any) {
            if (latestPreflightRequestKeyRef.current !== requestKey) return false;
            const message = error?.message || 'Couldn’t check the repository.';
            setPreflightState({ status: 'error', warnings: [], error: message, authSource: null });
            mergeImportSourceMetadata({
                githubPreflightStatus: 'error',
                githubPreflightError: message,
                githubPreflightCheckedAt: new Date().toISOString(),
            });
            setRepoRefreshRequired(hasGithubIdentity && isGithubAccessRefreshError(message));
            return false;
        }
    }, [branch, hasGithubIdentity, importSourceMetadata.githubInstallationId, loadBranchesForRepo, mergeImportSourceMetadata, normalizeGitHubRepoUrl, repoUrl, runRepoAnalysis, setValue]);

    const loadGithubPreview = useCallback(async (nextRepoUrl?: string, nextBranch?: string | null) => {
        const normalizedUrl = normalizeGitHubRepoUrl(nextRepoUrl || repoUrl || '');
        if (!normalizedUrl) {
            setShowManualGithubEntry(true);
            setIsEditingResolvedRepo(true);
            setPreflightState({
                status: 'error',
                warnings: [],
                error: 'Enter a valid GitHub repository URL.',
                authSource: null,
            });
            return;
        }

        const preflightOk = await runPreflightChecks(normalizedUrl, nextBranch ?? branch ?? null);
        if (!preflightOk) {
            setShowManualGithubEntry(true);
            setIsEditingResolvedRepo(true);
            return;
        }

        setShowManualGithubEntry(true);
        setIsEditingResolvedRepo(false);
        const resolvedPreviewBranch = getValues('import_source.branch') || nextBranch || branch || null;
        await startGithubRootPreview(normalizedUrl, resolvedPreviewBranch);
    }, [branch, getValues, normalizeGitHubRepoUrl, repoUrl, runPreflightChecks, startGithubRootPreview]);

    const githubResumePreviewStartedRef = useRef(false);
    useEffect(() => {
        if (
            !isResumingGithubOAuth
            || githubResumePreviewStartedRef.current
            || !hasGithubRepoAccess
            || !repoUrl
        ) return;

        githubResumePreviewStartedRef.current = true;
        void loadGithubPreview(repoUrl, branch || null);
    }, [branch, hasGithubRepoAccess, isResumingGithubOAuth, loadGithubPreview, repoUrl]);

    const handlePickRepository = async (item: GithubImportRepoItem) => {
        latestRepoAnalysisKeyRef.current = item.htmlUrl;
        setGithubEntryMode('browse');
        setValue('import_source.repoUrl', item.htmlUrl, { shouldDirty: true });
        if (item.defaultBranch) {
            setValue('import_source.branch', item.defaultBranch, { shouldDirty: true });
        }
        mergeImportSourceMetadata({
            githubRepoId: item.id,
            githubOwner: item.owner,
            githubName: item.name,
            githubVisibility: item.visibility,
            githubDescription: item.description,
            githubUpdatedAt: item.updatedAt,
            githubSizeKb: null,
            githubInstallationId: null,
            githubPreflightStatus: 'idle',
            githubPreflightError: null,
            githubPreflightWarnings: [],
        });
        setRepoPickerOpen(false);
        await loadGithubPreview(item.htmlUrl, item.defaultBranch);
    };

    useEffect(() => {
        if (activeSourceView !== 'github' || !repoPickerOpen || !hasGithubRepoAccess) return;
        const timer = setTimeout(() => {
            void loadRepositories(true, null);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeSourceView, hasGithubRepoAccess, loadRepositories, repoPickerOpen, repoQuery]);

    useEffect(() => {
        if (activeSourceView === 'github' && !repoUrl) {
            setBranchOptions([]);
            setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
            setGithubAnalysisResult(null);
            return;
        }
    }, [activeSourceView, repoUrl]);

    useEffect(() => {
        if (activeSourceView !== 'github') return;
        if (repoUrl || branch || preflightState.status !== 'idle') {
            setShowManualGithubEntry(true);
        }
        if (preflightState.status === 'ok') {
            setIsEditingResolvedRepo(false);
        }
    }, [activeSourceView, branch, preflightState.status, repoUrl]);

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    const handleGithubTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const nextMode = githubEntryMode === 'paste' ? 'browse' : 'paste';
        setGithubEntryMode(nextMode);
        setIsEditingResolvedRepo(true);
        if (nextMode === 'browse') setRepoPickerOpen(true);
        document.getElementById(`github-entry-tab-${nextMode}`)?.focus();
    };

    const processUploadFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        uploadAnalysisControllerRef.current?.abort();
        const analysisSequence = uploadAnalysisSequenceRef.current + 1;
        uploadAnalysisSequenceRef.current = analysisSequence;
        const manifest = buildUploadManifest(files);
        setUploadManifest(manifest);
        setUploadFiles(files);
        const currentMetadata = ((getValues('import_source.metadata') || {}) as ImportSourceMetadata);
        setValue(
            'import_source',
            {
                ...(getValues('import_source') || {}),
                type: 'upload',
                metadata: {
                    ...currentMetadata,
                    fileCount: manifest.totalFiles,
                    totalBytes: manifest.totalBytes,
                    folderName: manifest.folderName,
                    uploadValidationStatus: manifest.isValid ? 'ok' : 'error',
                    uploadValidationError: manifest.isValid
                        ? null
                        : `${manifest.blockedCount} ${manifest.blockedCount === 1 ? 'file needs' : 'files need'} attention.`,
                },
            },
            { shouldDirty: true, shouldValidate: true }
        );

        setUploadAnalysisResult(null);
        setUploadAnalysisError(null);
        if (!manifest.isValid) {
            setIsAnalyzingUpload(false);
            return;
        }

        setIsAnalyzingUpload(true);
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        uploadAnalysisControllerRef.current = controller;

        try {
            const { analyzeUploadedFolder } = await import('@/lib/upload/analyze-folder');
            const analysis = await analyzeUploadedFolder(files, controller?.signal);
            if (analysisSequence !== uploadAnalysisSequenceRef.current || controller?.signal.aborted) return;
            if (analysis.title || (analysis.technologies && analysis.technologies.length > 0)) {
                setUploadAnalysisResult(analysis);
                if (analysis.title && !getValues('title')?.trim()) {
                    setValue('title', analysis.title, { shouldDirty: true });
                }
                if (analysis.description && !getValues('description')?.trim()) {
                    setValue('description', analysis.description, { shouldDirty: true });
                }
                if (analysis.technologies.length > 0 && (getValues('technologies_used')?.length ?? 0) === 0) {
                    setValue('technologies_used', analysis.technologies, { shouldDirty: true });
                }
            }
        } catch (error: any) {
            if (error?.name !== 'AbortError' && analysisSequence === uploadAnalysisSequenceRef.current) {
                console.error('Folder analysis failed:', error);
                setUploadAnalysisError('We could not detect this workspace’s stack. The folder is still ready to use.');
            }
        } finally {
            if (analysisSequence === uploadAnalysisSequenceRef.current) {
                setIsAnalyzingUpload(false);
            }
        }
    }, [getValues, setUploadFiles, setValue]);

    useEffect(() => () => {
        uploadAnalysisControllerRef.current?.abort();
    }, []);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        await processUploadFiles(event.target.files);
    };

    const handleUploadDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isDragOverUpload) {
            setIsDragOverUpload(true);
        }
    };

    const handleUploadDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) {
            return;
        }
        setIsDragOverUpload(false);
    };

    const handleUploadDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOverUpload(false);
        const files = event.dataTransfer?.files ?? null;
        await processUploadFiles(files);
    };

    const rootEntries = githubFolderEntries[''] || githubPreview.rootEntries || [];
    const allLoadedEntries = Object.values(githubFolderEntries).flat();
    const loadedCounts = allLoadedEntries.reduce(
        (acc, entry) => {
            if (entry.excludedReason === 'ignored') acc.ignored += 1;
            else if (entry.excludedReason === 'tooLarge') acc.tooLarge += 1;
            else if (entry.type === 'dir') acc.folders += 1;
            else if (entry.type === 'file') acc.files += 1;
            return acc;
        },
        { files: 0, folders: 0, ignored: 0, tooLarge: 0 }
    );
    const toggleFolder = useCallback(async (folderPath: string, isDisabled: boolean) => {
        if (isDisabled) return;

        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folderPath)) next.delete(folderPath);
            else next.add(folderPath);
            return next;
        });

        if (!expandedFolders.has(folderPath) && !githubFolderEntries[folderPath] && !loadingFolders.has(folderPath)) {
            setLoadingFolders((prev) => new Set(prev).add(folderPath));
            try {
                await loadGithubFolder(folderPath);
            } finally {
                setLoadingFolders((prev) => {
                    const next = new Set(prev);
                    next.delete(folderPath);
                    return next;
                });
            }
        }
    }, [expandedFolders, githubFolderEntries, loadGithubFolder]);

    const renderTree = (entries: GithubPreviewEntry[], depth: number) => {
        if (!entries || entries.length === 0) {
            return (
                <div className="nb-compact py-2 text-muted-foreground">
                    No files found at this level.
                </div>
            );
        }

        return (
            <div className="space-y-1" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Repository files' : undefined}>
                {entries.map((entry) => {
                    const isFolder = entry.type === 'dir';
                    const disabled = entry.excludedReason === 'ignored' || entry.excludedReason === 'tooLarge';
                    const isExpanded = isFolder && expandedFolders.has(entry.path);
                    const isLoading = isFolder && loadingFolders.has(entry.path);
                    const children = isFolder ? githubFolderEntries[entry.path] : undefined;

                    return (
                        <div
                            key={entry.path}
                            role="treeitem"
                            aria-level={depth + 1}
                            aria-selected={false}
                            aria-expanded={isFolder && !disabled ? isExpanded : undefined}
                            aria-disabled={disabled || undefined}
                        >
                            <div
                                className={`flex min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-xs ${TREE_INDENT_CLASSES[Math.min(depth, TREE_INDENT_CLASSES.length - 1)]} ${
                                    disabled ? 'opacity-60' : 'hover:bg-muted'
                                }`}
                            >
                                {isFolder ? (
                                    <button
                                        type="button"
                                        onClick={() => toggleFolder(entry.path, disabled)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'ArrowRight' && !isExpanded) {
                                                e.preventDefault();
                                                toggleFolder(entry.path, disabled);
                                            } else if (e.key === 'ArrowLeft' && isExpanded) {
                                                e.preventDefault();
                                                toggleFolder(entry.path, disabled);
                                            }
                                        }}
                                        className="flex w-full min-w-0 items-center gap-2 text-left"
                                        disabled={disabled}
                                        aria-expanded={isExpanded}
                                    >
                                        {isLoading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : isExpanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                                        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <span className="min-w-0 truncate font-medium text-foreground">
                                            <span className="sr-only">Folder: </span>
                                            {entry.name}
                                        </span>
                                    </button>
                                ) : (
                                    <div className="flex w-full min-w-0 items-center gap-2">
                                        <span className="w-3.5" />
                                        <File className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <span className="min-w-0 truncate text-foreground">
                                            <span className="sr-only">File: </span>
                                            {entry.name}
                                        </span>
                                    </div>
                                )}

                                {entry.excludedReason === 'ignored' && (
                                    <span className="nb-status ml-auto shrink-0" data-status="archived">
                                        Ignored
                                    </span>
                                )}
                                {entry.excludedReason === 'tooLarge' && (
                                    <span className="nb-status ml-auto shrink-0" data-status="draft">
                                        Too large
                                    </span>
                                )}
                            </div>

                            {isFolder && isExpanded && !disabled && (
                                <div className="mt-1">
                                    {isLoading ? (
                                        <div className={`py-2 text-xs text-muted-foreground ${TREE_INDENT_CLASSES[Math.min(depth + 1, TREE_INDENT_CLASSES.length - 1)]}`} role="status">
                                            Loading…
                                        </div>
                                    ) : (
                                        renderTree(children || [], depth + 1)
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderScratchView = () => (
        <section
            className="border-t border-border pt-6"
            data-testid="create-project-source-view-scratch"
            aria-labelledby="scratch-source-heading"
        >
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.42fr)] md:items-start">
                <div>
                    <p className="nb-label text-primary">Start empty</p>
                    <h3 id="scratch-source-heading" className="nb-section-title mt-2 text-foreground">
                        Set up the workspace in the next steps
                    </h3>
                    <p className="nb-body mt-2 max-w-[62ch] text-muted-foreground">
                        Start with an empty workspace, then add its details, team, settings, and review it before publishing.
                    </p>
                </div>
                <dl className="border-l border-border pl-5 max-md:border-l-0 max-md:border-t max-md:pl-0 max-md:pt-4">
                    <dt className="nb-label">Workspace source</dt>
                    <dd className="nb-card-title mt-2 text-foreground">Start empty</dd>
                    <dd className="nb-compact mt-1 text-muted-foreground">
                        No repository or folder attached.
                    </dd>
                </dl>
            </div>
        </section>
    );

    const renderGithubView = () => {
        const normalizedRepoUrl = normalizeGitHubRepoUrl(repoUrl || '');
        const manualUrlLooksIncomplete =
            normalizedRepoUrl && !normalizedRepoUrl.includes('/') && !normalizedRepoUrl.includes('github.com/');
        const selectedRepoName =
            (importSourceMetadata.githubOwner && importSourceMetadata.githubName)
                ? `${String(importSourceMetadata.githubOwner)}/${String(importSourceMetadata.githubName)}`
                : '';
        const fallbackRepoName = normalizedRepoUrl.startsWith('https://github.com/')
            ? normalizedRepoUrl.replace('https://github.com/', '')
            : normalizedRepoUrl;
        const repoDisplayName = selectedRepoName || fallbackRepoName;
        const repoVisibility =
            typeof importSourceMetadata.githubVisibility === 'string'
                ? String(importSourceMetadata.githubVisibility)
                : null;
        const resolvedBranch = branch || githubPreview.branch || null;
        const hasResolvedGithubRepo = preflightState.status === 'ok' && Boolean(normalizedRepoUrl);
        const hasLoadedGithubRepo =
            hasResolvedGithubRepo
            && githubPreview.status === 'ready'
            && normalizeGitHubRepoUrl(githubPreview.repoUrl) === normalizedRepoUrl;
        const availableBranches = Array.from(new Set(
            [...branchOptions, resolvedBranch].filter((candidate): candidate is string => Boolean(candidate))
        ));
        const showDisconnectedCompactState =
            !isLoadingAuth
            && !hasGithubIdentity
            && !showManualGithubEntry;
        const shouldShowConnectGithubCta =
            !isLoadingAuth
            && !hasGithubIdentity
            && !hasGithubRepoAccess;
        const showMethodTabs = hasGithubRepoAccess;
        const showBrowsePanel = hasGithubRepoAccess && githubEntryMode === 'browse' && (!hasResolvedGithubRepo || isEditingResolvedRepo);
        const showPastePanel = githubEntryMode === 'paste' || !hasGithubRepoAccess;
        const showBranchEditor = isEditingResolvedRepo && hasResolvedGithubRepo && !hasLoadedGithubRepo;
        const showGithubDetails =
            preflightState.status === 'loading'
            || preflightState.status === 'error'
            || isAnalyzingGithub
            || githubPreview.status !== 'idle'
            || Boolean(githubAnalysisResult);

        return (
            <div className="space-y-8" data-testid="create-project-source-view-github">
                <section className="space-y-6" aria-labelledby="github-import-heading">
                        <div className="flex items-start gap-4">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-foreground">
                                <Github className="size-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 id="github-import-heading" className="nb-section-title text-foreground">
                                        Import from GitHub
                                    </h3>
                                    {isLoadingAuth ? (
                                        <span className="nb-status" data-status="archived">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Checking access
                                        </span>
                                    ) : githubAccountUnavailable && hasGithubIdentity ? (
                                        <span className="nb-status" data-status="draft">
                                            <CircleHelp className="h-3.5 w-3.5" />
                                            Account unavailable
                                        </span>
                                    ) : repoRefreshRequired && hasGithubIdentity ? (
                                        <span className="nb-status" data-status="draft">
                                            <CircleHelp className="h-3.5 w-3.5" />
                                            Resume{ghUsername ? ` as @${ghUsername}` : ''}
                                        </span>
                                    ) : hasGithubIdentity ? (
                                        <span className="nb-status" data-status="completed">
                                            <Check className="h-3.5 w-3.5" />
                                            Connected{ghUsername ? ` as @${ghUsername}` : ''}
                                        </span>
                                    ) : (
                                        <span className="nb-status" data-status="archived">
                                            GitHub not connected
                                        </span>
                                    )}
                                </div>
                                <p className="nb-body mt-2 max-w-[68ch] text-muted-foreground">
                                    Browse a connected repository or paste its GitHub URL. Review the branch and included files before continuing.
                                </p>
                                {isResumingGithubOAuth && (isLoadingAuth || isConnectingGithub) ? (
                                    <p className="nb-compact mt-3 flex items-center gap-2 text-muted-foreground" role="status">
                                        <Loader2 className="size-3.5 animate-spin" />
                                        GitHub is connected. Restoring your repository import…
                                    </p>
                                ) : null}
                            </div>
                        </div>

                        {showDisconnectedCompactState ? (
                            <div className="border-y border-border py-5">
                                <div className="max-w-2xl space-y-4">
                                    <p className="nb-compact text-muted-foreground">
                                        Connect GitHub if you want a repository picker. If not, you can still paste a repository link and continue with a manual import flow.
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <Button
                                            type="button"
                                            onClick={handleConnectGithub}
                                            data-testid="create-project-connect-github"
                                            disabled={isConnectingGithub}
                                        >
                                            {isConnectingGithub ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Redirecting to GitHub
                                                </span>
                                            ) : 'Connect GitHub'}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() => {
                                                setShowManualGithubEntry(true);
                                                setGithubEntryMode('paste');
                                                setIsEditingResolvedRepo(true);
                                            }}
                                        >
                                            Paste link manually
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {showMethodTabs && (
                                    <div className="flex border-b border-border" role="tablist" aria-label="GitHub repository entry method">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setGithubEntryMode('paste');
                                                setIsEditingResolvedRepo(true);
                                            }}
                                            onKeyDown={handleGithubTabKeyDown}
                                            id="github-entry-tab-paste"
                                            role="tab"
                                            aria-selected={githubEntryMode === 'paste'}
                                            tabIndex={githubEntryMode === 'paste' ? 0 : -1}
                                            aria-controls="github-entry-panel-paste"
                                            className={`relative -mb-px px-1 pb-3 pt-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                                githubEntryMode === 'paste'
                                                    ? 'border-b-2 border-primary text-foreground'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            Paste link
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setGithubEntryMode('browse');
                                                setIsEditingResolvedRepo(true);
                                                setRepoPickerOpen(true);
                                            }}
                                            onKeyDown={handleGithubTabKeyDown}
                                            id="github-entry-tab-browse"
                                            role="tab"
                                            aria-selected={githubEntryMode === 'browse'}
                                            tabIndex={githubEntryMode === 'browse' ? 0 : -1}
                                            aria-controls="github-entry-panel-browse"
                                            className={`relative -mb-px ml-6 px-1 pb-3 pt-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                                githubEntryMode === 'browse'
                                                    ? 'border-b-2 border-primary text-foreground'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            Browse repositories
                                        </button>
                                    </div>
                                )}

                                {repoRefreshRequired && hasGithubIdentity && !hasResolvedGithubRepo && (
                                    <div className="border-y border-[var(--status-warning)]/25 bg-[var(--status-warning-soft)] px-4 py-3 text-[var(--status-warning)]" role="status">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <span>{githubAccountUnavailable
                                                ? "The linked GitHub account may have been renamed, suspended, or deleted. Replace it in Settings before browsing private repositories."
                                                : "GitHub access needs a quick refresh before repository browsing can resume."}</span>
                                            {githubAccountUnavailable ? (
                                                <Button asChild type="button" variant="outline" size="sm">
                                                    <a href="/settings?tab=integrations">Review connection</a>
                                                </Button>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleConnectGithub}
                                                    disabled={isConnectingGithub}
                                                >
                                                    {isConnectingGithub ? (
                                                    <>
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        Refreshing access
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCcw className="h-3.5 w-3.5" />
                                                        Refresh access
                                                    </>
                                                    )}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {showBrowsePanel && (
                                    <section id="github-entry-panel-browse" role="tabpanel" aria-labelledby="github-entry-tab-browse" className="border-t border-border pt-5">
                                        <div className="flex flex-wrap items-end justify-between gap-3">
                                            <div>
                                                <h3 className="nb-card-title text-foreground">Browse repositories</h3>
                                                <p className="nb-compact mt-1 text-muted-foreground">Pick a repository directly from your connected GitHub account.</p>
                                            </div>
                                            <Button type="button" variant="ghost" size="sm" onClick={() => void loadRepositories(true, null)} disabled={isLoadingRepos}>
                                                <RefreshCcw className="size-4" />
                                                Refresh repositories
                                            </Button>
                                        </div>

                                        <div className="mt-4 flex gap-3">
                                            <label htmlFor="create-project-github-repo-search" className="sr-only">Search repositories</label>
                                            <Input
                                                id="create-project-github-repo-search"
                                                type="text"
                                                value={repoQuery}
                                                onChange={(e) => setRepoQuery(e.target.value)}
                                                placeholder="Search your repositories"
                                                data-testid="create-project-github-repo-search"
                                            />
                                        </div>

                                        {repoLoadError ? (
                                            <div className="mt-4 border-y border-[var(--status-danger)]/25 bg-[var(--status-danger-soft)] px-4 py-3 text-[var(--status-danger)]" role="alert">
                                                <p className="nb-compact">{repoLoadError}</p>
                                            </div>
                                        ) : null}

                                        {repoPickerOpen && hasGithubRepoAccess ? (
                                            <div className="mt-4 border-y border-border" role="listbox" aria-label="GitHub repositories">
                                                {repoItems.length === 0 && !isLoadingRepos ? (
                                                    <div className="nb-compact px-3 py-5 text-muted-foreground">
                                                        {repoLoadedOnce
                                                            ? (repoQuery ? 'No repositories matched this search.' : 'No connected repositories were returned for this account.')
                                                            : 'Loading connected repositories…'}
                                                    </div>
                                                ) : null}
                                                {repoItems.map((item) => {
                                                    const isSelected = normalizeGitHubRepoUrl(repoUrl || '') === item.htmlUrl;
                                                    return (
                                                        <button
                                                            key={`${item.id}-${item.fullName}`}
                                                            type="button"
                                                            role="option"
                                                            aria-selected={isSelected}
                                                            onClick={() => void handlePickRepository(item)}
                                                            className={`flex min-h-14 w-full items-center justify-between gap-4 border-b border-border px-3 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${isSelected ? 'bg-secondary' : 'hover:bg-muted/60'}`}
                                                        >
                                                            <span className="min-w-0">
                                                                <span className="nb-compact block truncate font-medium text-foreground">{item.fullName}</span>
                                                                <span className="nb-meta mt-1 block text-muted-foreground">{item.visibility}{item.defaultBranch ? ` · ${item.defaultBranch}` : ''}</span>
                                                            </span>
                                                            {isSelected ? <Check className="size-4 shrink-0 text-primary" aria-label="Selected" /> : null}
                                                        </button>
                                                    );
                                                })}
                                                {isLoadingRepos ? (
                                                    <div className="space-y-3 px-3 py-4" role="status" aria-label="Loading repositories">
                                                        {[0, 1, 2].map((row) => <div key={row} className="space-y-2" aria-hidden="true"><div className="nb-skeleton h-3 w-2/3 rounded-sm" /><div className="nb-skeleton h-2.5 w-1/3 rounded-sm" /></div>)}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}

                                        {repoCursor ? (
                                            <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => void loadRepositories(false, repoCursor)} disabled={isLoadingRepos}>
                                                Load more repositories
                                            </Button>
                                        ) : null}
                                    </section>
                                )}

                                {showPastePanel && (
                                    <section id="github-entry-panel-paste" role="tabpanel" aria-labelledby="github-entry-tab-paste" className="border-t border-border pt-5">
                                        <div>
                                            <div className="nb-card-title text-foreground">
                                                Paste a repository link
                                            </div>
                                            <p className="nb-compact mt-1 text-muted-foreground">
                                                Use <span className="font-medium text-foreground">owner/repo</span> or a full GitHub repository URL.
                                            </p>
                                        </div>

                                        <label htmlFor="create-project-github-url" className="nb-meta mt-4 block text-foreground">Repository</label>
                                        <div className="mt-2 relative">
                                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                                <Github className="h-4 w-4 text-muted-foreground" />
                                            </div>
                                            <Input
                                                id="create-project-github-url"
                                                type="text"
                                                value={repoUrl || ''}
                                                data-testid="create-project-github-manual-url"
                                                className="pl-9"
                                                placeholder="owner/repo or https://github.com/owner/repo"
                                                aria-describedby="create-project-github-url-help create-project-github-url-format-error create-project-github-url-error"
                                                aria-invalid={Boolean(manualUrlLooksIncomplete || preflightState.status === 'error')}
                                                onChange={(e) => {
                                                    const normalized = normalizeGitHubRepoUrl(e.target.value);
                                                    latestRepoAnalysisKeyRef.current = normalized;
                                                    setValue('import_source.repoUrl', normalized, { shouldDirty: true });
                                                    mergeImportSourceMetadata({
                                                        githubPreflightStatus: 'idle',
                                                        githubPreflightError: null,
                                                        githubPreflightWarnings: [],
                                                        githubDescription: null,
                                                        githubUpdatedAt: null,
                                                        githubSizeKb: null,
                                                    });
                                                    setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
                                                    setGithubAnalysisResult(null);
                                                    setShowManualGithubEntry(true);
                                                    setIsEditingResolvedRepo(true);
                                                    setGithubEntryMode('paste');
                                                }}
                                            />
                                        </div>
                                        <p id="create-project-github-url-help" className="nb-compact mt-2 text-muted-foreground">Use owner/repository or the full HTTPS repository URL.</p>
                                        {manualUrlLooksIncomplete && (
                                            <div id="create-project-github-url-format-error" role="alert" className="nb-compact mt-2 text-[var(--status-warning)]">
                                                Enter both owner and repository name. A GitHub username alone is not enough for import.
                                            </div>
                                        )}

                                        {showBranchEditor && (
                                            <div className="mt-4 space-y-2">
                                                <label htmlFor="create-project-github-branch" className="block text-sm font-medium text-foreground">
                                                    Branch
                                                </label>
                                                {branchOptions.length > 0 ? (
                                                    <select
                                                        id="create-project-github-branch"
                                                        value={branch || ''}
                                                        data-testid="create-project-github-branch-select"
                                                        onChange={(e) => {
                                                            setValue('import_source.branch', e.target.value, { shouldDirty: true });
                                                            mergeImportSourceMetadata({
                                                                githubPreflightStatus: 'idle',
                                                                githubPreflightError: null,
                                                            });
                                                            setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
                                                        }}
                                                        className="h-[var(--ui-control-height)] w-full rounded-md border border-input bg-card px-[var(--ui-control-px)] text-[15px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                                                    >
                                                        {branchOptions.map((option) => (
                                                            <option key={option} value={option}>
                                                                {option}
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <Input
                                                        id="create-project-github-branch"
                                                        type="text"
                                                        value={branch || ''}
                                                        data-testid="create-project-github-branch-input"
                                                        onChange={(e) => {
                                                            setValue('import_source.branch', e.target.value, { shouldDirty: true });
                                                            mergeImportSourceMetadata({
                                                                githubPreflightStatus: 'idle',
                                                                githubPreflightError: null,
                                                            });
                                                            setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
                                                        }}
                                                        placeholder="main"
                                                    />
                                                )}
                                                {isLoadingBranches && (
                                                    <div className="nb-meta flex items-center gap-2 text-muted-foreground" role="status">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Loading branches…
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="mt-5 flex flex-wrap items-center gap-3">
                                            {!hasLoadedGithubRepo ? (
                                                <Button
                                                    type="button"
                                                    disabled={!repoUrl || preflightState.status === 'loading' || githubPreview.status === 'loading'}
                                                    onClick={() => void loadGithubPreview(repoUrl, branch || null)}
                                                    data-testid="create-project-github-preview"
                                                    aria-busy={preflightState.status === 'loading' || githubPreview.status === 'loading'}
                                                >
                                                    {preflightState.status === 'loading' || githubPreview.status === 'loading' ? (
                                                        <>
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            Loading repository…
                                                        </>
                                                    ) : 'Load repository'}
                                                </Button>
                                            ) : null}
                                            {shouldShowConnectGithubCta && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleConnectGithub}
                                                    disabled={isConnectingGithub}
                                                >
                                                    {isConnectingGithub ? (
                                                        <span className="inline-flex items-center gap-2">
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            Redirecting to GitHub
                                                        </span>
                                                    ) : 'Connect GitHub instead'}
                                                </Button>
                                            )}
                                        </div>

                                        {preflightState.status === 'error' && preflightState.error && (
                                            <div id="create-project-github-url-error" role="alert" className="mt-4 border-y border-[var(--status-danger)]/25 bg-[var(--status-danger-soft)] px-4 py-3 text-[var(--status-danger)]">
                                                {preflightState.error}
                                            </div>
                                        )}
                                    </section>
                                )}

                                {showGithubDetails && (
                                    <GithubImportDetails
                                        status={preflightState.status === 'loading' || isAnalyzingGithub ? 'loading' : preflightState.status === 'error' ? 'error' : githubPreview.status}
                                        repositoryName={repoDisplayName}
                                        visibility={repoVisibility}
                                        branch={resolvedBranch}
                                        description={githubAnalysisResult?.description || (typeof importSourceMetadata.githubDescription === 'string' ? importSourceMetadata.githubDescription : null)}
                                        technologies={githubAnalysisResult?.technologies || []}
                                        counts={loadedCounts}
                                        sizeKb={typeof importSourceMetadata.githubSizeKb === 'number' ? importSourceMetadata.githubSizeKb : null}
                                        updatedAt={typeof importSourceMetadata.githubUpdatedAt === 'string' ? importSourceMetadata.githubUpdatedAt : null}
                                        authSource={preflightState.authSource}
                                        warnings={preflightState.warnings}
                                        errorMessage={preflightState.error || githubPreview.errorMessage}
                                        branchControl={hasLoadedGithubRepo ? (
                                            <div className="flex h-[var(--ui-control-height-sm)] items-center gap-1.5 rounded-md border border-input bg-card pl-2 pr-1 text-foreground focus-within:bg-muted/20">
                                                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                <label htmlFor="create-project-github-resolved-branch" className="sr-only">Repository branch</label>
                                                <select
                                                    id="create-project-github-resolved-branch"
                                                    value={resolvedBranch || ''}
                                                    onChange={(event) => {
                                                        const nextBranch = event.target.value;
                                                        setValue('import_source.branch', nextBranch, { shouldDirty: true });
                                                        void loadGithubPreview(normalizedRepoUrl, nextBranch);
                                                    }}
                                                    disabled={isLoadingBranches || preflightState.status === 'loading' || githubPreview.status === 'loading'}
                                                    aria-busy={preflightState.status === 'loading' || githubPreview.status === 'loading'}
                                                    className="h-full min-w-0 max-w-40 bg-transparent pr-5 text-[13px] font-medium text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {availableBranches.map((option) => <option key={option} value={option}>{option}</option>)}
                                                </select>
                                            </div>
                                        ) : undefined}
                                        fileTree={githubPreview.status === 'ready' ? renderTree(rootEntries, 0) : null}
                                    />
                                )}
                                {githubPreview.status === 'ready' && githubEntryMode === 'browse' && !isEditingResolvedRepo ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setGithubEntryMode('browse');
                                            setIsEditingResolvedRepo(true);
                                            setRepoPickerOpen(true);
                                        }}
                                    >
                                        Browse another repository
                                    </Button>
                                ) : null}
                            </div>
                        )}
                </section>
            </div>
        );
    };

    const renderUploadView = () => (
        <div className="space-y-6" data-testid="create-project-source-view-upload">
            <section className="space-y-6" aria-labelledby="upload-source-heading">
                <div className="flex items-start gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-primary">
                        <FolderUp className="size-5" />
                    </div>
                    <div>
                        <h3 id="upload-source-heading" className="nb-section-title text-foreground">
                            Upload a folder
                        </h3>
                        <p className="nb-body mt-2 max-w-[68ch] text-muted-foreground">
                            Choose a local folder, check its contents, and review the detected stack before continuing.
                        </p>
                    </div>
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    // @ts-expect-error - webkitdirectory is a non-standard attribute
                    webkitdirectory=""
                    multiple
                    onChange={handleFileSelect}
                />

                <div className="mt-6 space-y-5">
                    <div
                        data-testid="create-project-upload-dropzone"
                        onDragOver={handleUploadDragOver}
                        onDragEnter={handleUploadDragOver}
                        onDragLeave={handleUploadDragLeave}
                        onDrop={(event) => void handleUploadDrop(event)}
                        className={`rounded-lg border border-dashed p-8 transition-colors ${
                            isDragOverUpload
                                ? 'border-primary bg-primary/5'
                                : 'border-input bg-secondary/45'
                        }`}
                    >
                        {uploadFiles && uploadFiles.length > 0 ? (
                            <div className="space-y-4 text-center">
                                <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-border bg-card text-[var(--status-success)]">
                                    <Check className="size-5" />
                                </div>
                                <div className="nb-card-title text-foreground">
                                    {uploadFiles.length} files selected
                                </div>
                                <div className="nb-compact text-muted-foreground">
                                    {uploadAnalysisResult?.title ? `Detected workspace: ${uploadAnalysisResult.title}` : 'The selected folder will remain attached through every phase.'}
                                </div>
                                <Button type="button" variant="outline" onClick={handleBrowseClick}>
                                    Change folder
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-4 text-center">
                                <div className="nb-card-title text-foreground">
                                    {isDragOverUpload ? 'Drop folder to attach it' : 'Select a folder'}
                                </div>
                                <div className="nb-compact text-muted-foreground">
                                    Drag and drop a folder here, or browse from your device. Files can be up to 10 MB each.
                                </div>
                                <Button type="button" onClick={handleBrowseClick} data-testid="create-project-upload-browse">
                                    Browse folder
                                </Button>
                            </div>
                        )}
                    </div>

                    {uploadManifest ? <UploadManifestPreview manifest={uploadManifest} /> : null}

                    {(isAnalyzingUpload || uploadAnalysisResult || uploadAnalysisError) ? (
                        <section className="border-t border-border pt-5" aria-labelledby="upload-analysis-heading">
                            <div className="flex items-center gap-2">
                                <h4 id="upload-analysis-heading" className="nb-card-title text-foreground">
                                    Detected workspace
                                </h4>
                            </div>
                            {isAnalyzingUpload ? (
                                <div className="nb-compact mt-4 flex items-center gap-2 text-primary" role="status">
                                    <Loader2 className="size-4 animate-spin" />
                                    Inspecting uploaded files…
                                </div>
                            ) : uploadAnalysisResult ? (
                                <div className="mt-4 space-y-3">
                                    {uploadAnalysisResult.title && (
                                        <div className="nb-card-title text-foreground">
                                            {uploadAnalysisResult.title}
                                        </div>
                                    )}
                                    {uploadAnalysisResult.description && (
                                        <div className="nb-compact text-muted-foreground">
                                            {uploadAnalysisResult.description}
                                        </div>
                                    )}
                                    {uploadAnalysisResult.technologies.length > 0 && (
                                        <SkillList skills={uploadAnalysisResult.technologies} size="sm" />
                                    )}
                                </div>
                            ) : (
                                <div className="nb-compact mt-4 text-muted-foreground" role="status">
                                    {uploadAnalysisError}
                                </div>
                            )}
                        </section>
                    ) : null}
                </div>
            </section>
        </div>
    );

    const sourcePanel = organization
        ? <OrgTypePicker />
        : activeSourceView === 'github'
        ? renderGithubView()
        : activeSourceView === 'upload'
            ? renderUploadView()
            : renderScratchView();

    return (
        <div className="min-w-0 w-full space-y-8 pb-6">
            <WherePicker />
            <Phase1SourceMethodGroup
                value={organization ? 'organization' : selectedSource}
                onChange={handleSelectStartingPoint}
                // Orgs cannot nest: no Organization card inside an org (report §14.3).
                showOrganization={!location.org || Boolean(organization)}
            />
            <section
                id={`create-project-source-panel-${activeSourceView}`}
                aria-label={`${activeSourceView} workspace source settings`}
            >
                {sourcePanel}
            </section>
        </div>
    );
}
