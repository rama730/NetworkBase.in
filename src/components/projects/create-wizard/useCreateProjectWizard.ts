'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema, type CreateProjectInput, type OpenRoleInput } from '@/lib/validations/project';
import { DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY } from '@/lib/projects/settings-policies';
import { toast, feedbackError } from "@/lib/feedback";
import { TOTAL_PHASES, WizardPhaseId } from '@/constants/project-wizard';
import { createProjectAction } from '@/app/actions/project';
import { checkOrgHandleAction } from '@/app/actions/organizations';
import { parseGithubRepo } from '@/lib/github/repo-preview';
import { fetchGithubImportPreviewFolder, fetchGithubImportPreviewRoot } from '@/lib/github/import-client';
import { shouldIgnorePath } from '@/lib/import/import-filters';
import { getLifecycleStagesForProjectType } from '@/lib/projects/lifecycle-templates';
import { buildProjectDocStarterDraft } from '@/lib/projects/doc-create-intent';
import { buildProjectImportEventId, buildUploadManifestHash } from '@/lib/import/idempotency';
import { buildProjectFileKey } from '@/lib/storage/project-file-key';
import { useAuth } from '@/hooks/use-auth';

export interface WizardContextType {
    openRoles: OpenRoleInput[];
    openRoleIds: string[];
    addRole: () => void;
    updateRole: (index: number, updates: Partial<OpenRoleInput>) => void;
    removeRole: (index: number) => void;
    /** Fills an empty team from the org's default units, once per org (report §14.4 additions). */
    prefillUnits: (orgId: string, names: string[]) => void;
}

interface UseCreateProjectWizardProps {
    onClose: () => void;
    onSuccess?: (projectId: string, organization?: { title: string; joinCode: string }) => void;
    initialValues?: CreateProjectInput;
    initialPhase?: WizardPhaseId;
}

/**
 * useCreateProjectWizard - The master hook for project creation.
 * Pure Optimization: Unified constants, reactive draft management, and scalable logic.
 */
export function useCreateProjectWizard({ onClose, onSuccess, initialValues, initialPhase = 1 }: UseCreateProjectWizardProps) {
    const { user } = useAuth();
    const userId = user?.id || null;
    const [phase, setPhase] = useState<WizardPhaseId>(initialPhase);
    const phaseRef = useRef<WizardPhaseId>(phase);
    useEffect(() => {
        phaseRef.current = phase;
    }, [phase]);
    const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
    // Step 4 project picture: held in memory, uploaded right after the project exists.
    const [projectImage, setProjectImage] = useState<File | null>(null);
    const [uploadProgress, setUploadProgress] = useState<{
        percent: number;
        currentFile: string;
        isUploading: boolean;
    } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [phase2ValidationAttempted, setPhase2ValidationAttempted] = useState(false);
    const [phase3ValidationAttempted, setPhase3ValidationAttempted] = useState(false);
    const [phase4ValidationAttempted, setPhase4ValidationAttempted] = useState(false);
    const [phase4LinkComposerPending, setPhase4LinkComposerPending] = useState(false);
    const [isPhaseTransitioning, setIsPhaseTransitioning] = useState(false);
    const [isReviewReady, setIsReviewReady] = useState(false);
    const phaseTransitionRef = useRef(false);
    const submissionRef = useRef(false);
    const phaseTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [draftInfo, setDraftInfo] = useState<{
        exists: boolean;
        phase: number;
        savedAt: Date | null;
        parentOrgId?: string | null;
    } | null>(null);

    // Form Setup
    const methods = useForm<CreateProjectInput>({
        resolver: zodResolver(createProjectSchema) as any,
        mode: 'onChange',
        defaultValues: initialValues ?? {
            title: '',
            description: '',
            short_description: '',
            project_type: '',
            custom_project_type: '',
            status: 'open',
            visibility: 'public',
            tags: [],
            technologies_used: [],
            lifecycle_stages: [],
            current_stage_index: 0,
            creator_role: {
                role_type: 'lead',
                title: '',
            },
            roles: [],
            import_source: { type: 'scratch' },
            external_links: [],
            // Step 4 launch settings; defaults match Project settings so Continue works untouched.
            public_tab_visibility: { ...DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY },
            member_updates_enabled: true,
            member_file_upload_default: true,
            doc_edit_policy: 'leaders',
            notification_rows: { roles_applications: true, work: true, updates_docs: true },
            readme: {
                mode: 'starter',
                sourcePath: null,
                publishOnCreate: false,
                includeRoles: true,
            },
            metadata: {},
        },
    });

    const { getValues, setValue, trigger, formState: { isDirty }, watch, reset } = methods;
    const {
        fields: openRoleFields,
        append: appendOpenRole,
        remove: removeOpenRole,
    } = useFieldArray({
        control: methods.control,
        name: 'roles',
    });
    const openRoles = watch('roles') || [];

    // --- Lifecycle Autofill (Phase 3) ---
    const watchedProjectType = watch('project_type');
    const watchedLifecycleStages = watch('lifecycle_stages') || [];
    const lastAutofilledStagesRef = useRef<string[] | null>(null);

    const arraysEqual = useCallback((a: string[] | null | undefined, b: string[] | null | undefined) => {
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }, []);

    useEffect(() => {
        const type = (watchedProjectType || '').trim();
        if (!type) return;

        // If empty, always autofill from template.
        if (!watchedLifecycleStages || watchedLifecycleStages.length === 0) {
            const next = getLifecycleStagesForProjectType(type);
            setValue('lifecycle_stages', next, { shouldDirty: true });
            lastAutofilledStagesRef.current = next;
            return;
        }

        // If the user hasn't edited (still equals last autofill), update when type changes.
        if (lastAutofilledStagesRef.current && arraysEqual(watchedLifecycleStages, lastAutofilledStagesRef.current)) {
            const next = getLifecycleStagesForProjectType(type);
            if (!arraysEqual(next, watchedLifecycleStages)) {
                setValue('lifecycle_stages', next, { shouldDirty: true });
                lastAutofilledStagesRef.current = next;
            }
            return;
        }

        // If stages equal the server generic default (legacy), consider it “un-edited” and upgrade to template once.
        const legacyDefault = ["Concept", "Team Formation", "MVP", "Beta", "Launch"];
        if (arraysEqual(watchedLifecycleStages, legacyDefault)) {
            const next = getLifecycleStagesForProjectType(type);
            setValue('lifecycle_stages', next, { shouldDirty: true });
            lastAutofilledStagesRef.current = next;
        }
    }, [arraysEqual, setValue, watchedLifecycleStages, watchedProjectType]);

    // --- GitHub Preview (Phase 1) ---
    type GithubPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
    type GithubExcludedReason = 'ignored' | 'tooLarge';
    type GithubPreviewEntry = {
        name: string;
        path: string;
        type: 'file' | 'dir';
        size?: number | null;
        excludedReason?: GithubExcludedReason;
    };

    const [githubPreview, setGithubPreview] = useState<{
        status: GithubPreviewStatus;
        repoUrl: string;
        branch: string | null;
        rootEntries: GithubPreviewEntry[];
        errorMessage: string | null;
    }>({
        status: 'idle',
        repoUrl: '',
        branch: null,
        rootEntries: [],
        errorMessage: null,
    });

    const [githubFolderEntries, setGithubFolderEntries] = useState<Record<string, GithubPreviewEntry[]>>({});
    const latestGithubPreviewRequestRef = useRef('');

    // useWatch, not watch(): whole-object import_source writes must still reset the GitHub preview.
    const [importSourceType, watchedRepoUrl, watchedBranch] = useWatch({
        control: methods.control,
        name: ['import_source.type', 'import_source.repoUrl', 'import_source.branch'],
    });

    const resetGithubPreview = useCallback(() => {
        latestGithubPreviewRequestRef.current = '';
        setGithubPreview({
            status: 'idle',
            repoUrl: '',
            branch: null,
            rootEntries: [],
            errorMessage: null,
        });
        setGithubFolderEntries({});
    }, []);

    // Reset preview when source or repo changes.
    useEffect(() => {
        if (importSourceType !== 'github') {
            if (githubPreview.status !== 'idle') resetGithubPreview();
            return;
        }

        const nextUrl = (watchedRepoUrl || '').trim();
        if (!nextUrl) {
            if (githubPreview.status !== 'idle') resetGithubPreview();
            return;
        }

        if (githubPreview.repoUrl && githubPreview.repoUrl !== nextUrl) {
            resetGithubPreview();
        }
    }, [importSourceType, watchedRepoUrl, githubPreview.status, githubPreview.repoUrl, resetGithubPreview]);

    const startGithubRootPreview = useCallback(async (repoUrl: string, branchOverride?: string | null) => {
        const url = (repoUrl || '').trim();
        if (!url) return;
        const requestedBranch = branchOverride ?? watchedBranch ?? null;
        const requestKey = `${url}#${requestedBranch || ''}`;
        latestGithubPreviewRequestRef.current = requestKey;

        // Clear the previous repository before requesting a new manifest so its
        // files can never be presented under the next repository's identity.
        setGithubFolderEntries({});
        setGithubPreview((prev) => {
            if (
                prev.status === 'loading'
                && prev.repoUrl === url
                && (prev.branch ?? null) === requestedBranch
            ) return prev;
            return {
                status: 'loading',
                repoUrl: url,
                branch: requestedBranch,
                rootEntries: [],
                errorMessage: null,
            };
        });

        try {
            const parsed = parseGithubRepo(url);
            if (!parsed) {
                setGithubPreview((prev) => ({ ...prev, status: 'error', errorMessage: 'Invalid GitHub repo URL.' }));
                return;
            }

            const preferredInstallationId = (getValues('import_source.metadata') as any)?.githubInstallationId ?? null;
            const res = await fetchGithubImportPreviewRoot({
                repoUrl: url,
                branch: requestedBranch,
                installationId: preferredInstallationId,
            });
            if (latestGithubPreviewRequestRef.current !== requestKey) return;
            const branch = res.branch || 'main';

            // Store branch in form so the import worker uses the same ref.
            if (!watchedBranch && branch) {
                setValue('import_source.branch', branch, { shouldDirty: true });
            }
            const normalizedUrl = res.normalizedRepoUrl || url;
            const rootEntries = res.rootEntries;

            setGithubFolderEntries({ '': rootEntries });
            setGithubPreview({
                status: 'ready',
                repoUrl: normalizedUrl,
                branch,
                rootEntries,
                errorMessage: null,
            });
            if (normalizedUrl !== url) {
                setValue('import_source.repoUrl', normalizedUrl, { shouldDirty: true });
            }
        } catch (e: any) {
            if (latestGithubPreviewRequestRef.current !== requestKey) return;
            const message = typeof e?.message === 'string' ? e.message : 'Failed to preview repository.';
            setGithubPreview((prev) => ({
                ...prev,
                status: 'error',
                repoUrl: url,
                errorMessage: message,
                rootEntries: [],
            }));
        }
    }, [getValues, setValue, watchedBranch]);

    const loadGithubFolder = useCallback(async (folderPath: string) => {
        const baseUrl = (githubPreview.repoUrl || '').trim();
        const branch = githubPreview.branch || watchedBranch || null;
        if (!baseUrl || !branch) return;

        const key = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
        if (githubFolderEntries[key]) return;

        // Don’t fetch ignored folders.
        if (shouldIgnorePath(key)) {
            setGithubFolderEntries((prev) => ({ ...prev, [key]: [] }));
            return;
        }

        const parsed = parseGithubRepo(baseUrl);
        if (!parsed) return;

        try {
            const preferredInstallationId = (getValues('import_source.metadata') as any)?.githubInstallationId ?? null;
            const res = await fetchGithubImportPreviewFolder({
                repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
                branch,
                path: key,
                installationId: preferredInstallationId,
            });
            if ((getValues('import_source.repoUrl') || '').trim() !== baseUrl || (getValues('import_source.branch') || branch) !== branch) {
                return;
            }
            const entries = res.entries;
            setGithubFolderEntries((prev) => ({ ...prev, [key]: entries }));
        } catch {
            if ((getValues('import_source.repoUrl') || '').trim() !== baseUrl || (getValues('import_source.branch') || branch) !== branch) {
                return;
            }
            // Non-blocking: folder expansion can fail silently; keep UX smooth.
            setGithubFolderEntries((prev) => ({ ...prev, [key]: [] }));
        }
    }, [getValues, githubFolderEntries, githubPreview.branch, githubPreview.repoUrl, watchedBranch]);

    // --- Draft Management ---

    // Check for existing draft on mount
    useEffect(() => {
        const checkDraft = async () => {
            const { draftStore } = await import('@/lib/storage/draft-store');
            const info = await draftStore.getInfo(userId);
            if (info.exists) {
                setDraftInfo({
                    exists: true,
                    phase: info.phase,
                    savedAt: info.savedAt,
                    parentOrgId: info.parentOrgId ?? null,
                });
            }
        };
        checkDraft();
    }, [userId]);

    const restoreDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');
        const draft = await draftStore.load(userId);
        if (draft) {
            reset(draft);
            if (draft._timestamp) setLastSaved(new Date(draft._timestamp));
            let targetPhase = (draft._phase || 1) as WizardPhaseId;
            // Validate step by step up to targetPhase to ensure user doesn't land on a later phase with invalid earlier data
            if (targetPhase > 1) {
                const source = draft.import_source?.type;
                if (!source || (source === 'github' && !draft.import_source?.repoUrl)) {
                    targetPhase = 1;
                }
            }
            if (targetPhase > 2) {
                const titleValid = typeof draft.title === 'string' && draft.title.trim().length >= 3;
                const descValid = typeof draft.description === 'string' && draft.description.trim().length >= 20;
                const typeValid = typeof draft.project_type === 'string' && draft.project_type.trim().length > 0;
                const customTypeValid = draft.project_type !== 'other' || (typeof draft.custom_project_type === 'string' && draft.custom_project_type.trim().length > 0);
                if (!titleValid || !descValid || !typeValid || !customTypeValid) {
                    targetPhase = 2;
                }
            }
            if (targetPhase > 3) {
                if (Array.isArray(draft.roles)) {
                    const hasInvalidRole = draft.roles.some((r: any) => !r.role || !r.role.trim());
                    if (hasInvalidRole) targetPhase = 3;
                }
            }
            setPhase(targetPhase);
            setDraftInfo(null);
            toast.success("Draft restored");
        }
    }, [reset, userId]);

    const deleteDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');

        // Client-side total wipe
        await draftStore.clear(userId);
        setDraftInfo(null);
        reset();
        setPhase(1);
        toast.success("Draft erased completely");
    }, [reset, userId]);

    const saveDraft = useCallback(async (silent = false) => {
        if (!silent) {
            setIsSavingDraft(true);
            setSaveStatus('saving');
        }
        try {
            const { draftStore } = await import('@/lib/storage/draft-store');
            await draftStore.save(getValues(), phaseRef.current, userId);
            setLastSaved(new Date());
            if (!silent) {
                setSaveStatus('saved');
                window.setTimeout(() => setSaveStatus('idle'), 2000);
            }
        } catch (error) {
            console.error('[create-project] Failed to save draft', error);
            setSaveStatus('error');
            if (!silent) toast.error('Draft could not be saved. Please try again.');
        } finally {
            if (!silent) setIsSavingDraft(false);
        }
    }, [getValues, userId]);

    // Auto-Save Optimization (Debounced subscription covering both user and programmatic edits)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        const subscription = watch(() => {
            if (!isDirty) return;

            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(() => saveDraft(true), 5000);
        });
        return () => {
            subscription.unsubscribe();
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [isDirty, watch, saveDraft]);

    // --- Role Management ---
    const addRole = useCallback(() => {
        appendOpenRole({
            role: '',
            count: 1,
            description: '',
            skills: [],
            experienceLevel: 'any',
            compensationType: 'unpaid',
            compensationDetails: '',
        }, { shouldFocus: true });
    }, [appendOpenRole]);

    const updateRole = useCallback((index: number, updates: Partial<OpenRoleInput>) => {
        const roles = getValues('roles') || [];
        const currentRole = roles[index];
        if (!currentRole) return;

        setValue(`roles.${index}` as any, { ...currentRole, ...updates }, { shouldDirty: true, shouldValidate: true });
    }, [getValues, setValue]);

    const removeRole = useCallback((index: number) => {
        removeOpenRole(index);
    }, [removeOpenRole]);

    const prefilledUnitsFor = useRef<string | null>(null);
    const prefillUnits = useCallback((orgId: string, names: string[]) => {
        if (prefilledUnitsFor.current === orgId || names.length === 0 || (getValues('roles') ?? []).length > 0) return;
        prefilledUnitsFor.current = orgId;
        appendOpenRole(names.map((role) => ({ role, count: 1, description: '', skills: [], experienceLevel: 'any' as const, compensationType: 'unpaid' as const, compensationDetails: '' })));
    }, [appendOpenRole, getValues]);

    const wizardContext: WizardContextType = useMemo(() => ({
        openRoles,
        openRoleIds: openRoleFields.map((field) => field.id),
        addRole,
        updateRole,
        removeRole,
        prefillUnits,
    }), [openRoles, openRoleFields, addRole, updateRole, removeRole, prefillUnits]);

    // Phase is navigation only. Reaching a later step does not make the
    // project dirty, so closing after restoring all values must not prompt.
    // Keep the two non-form inputs that would otherwise be lost in the check.
    const hasUnsavedWizardChanges = isDirty
        || Boolean(uploadFiles?.length)
        || Boolean(projectImage);

    // Leaving without the confirm dialog (browser Back) keeps the work: unsaved changes become a
    // draft on unmount. "Leave setup" and a successful create opt out via markLeaving().
    const skipDraftOnUnmountRef = useRef(false);
    const hasUnsavedRef = useRef(hasUnsavedWizardChanges);
    const saveDraftRef = useRef(saveDraft);
    useEffect(() => {
        hasUnsavedRef.current = hasUnsavedWizardChanges;
        saveDraftRef.current = saveDraft;
    }, [hasUnsavedWizardChanges, saveDraft]);
    useEffect(() => () => {
        if (hasUnsavedRef.current && !skipDraftOnUnmountRef.current) void saveDraftRef.current(true);
    }, []);
    const markLeaving = useCallback(() => {
        skipDraftOnUnmountRef.current = true;
    }, []);

    useEffect(() => {
        if (phase !== TOTAL_PHASES) setIsReviewReady(false);
    }, [phase]);

    useEffect(() => () => {
        if (phaseTransitionTimerRef.current) clearTimeout(phaseTransitionTimerRef.current);
    }, []);

    // --- Navigation ---
    const handleNext = useCallback(async () => {
        if (isSubmitting || phaseTransitionRef.current) return;

        phaseTransitionRef.current = true;
        setIsPhaseTransitioning(true);
        let isValid = false;
        let holdTransitionForReview = false;

        try {
            if (phase === 1) {
                const importType = getValues('import_source.type') || 'scratch';
                if (importType === 'github') {
                    const repoUrl = (getValues('import_source.repoUrl') || '').trim();
                    if (!repoUrl) {
                        toast.error('Please paste a GitHub repository link.');
                        return;
                    }

                    const metadata = (getValues('import_source.metadata') || {}) as Record<string, unknown>;
                    const preflightReady = metadata.githubPreflightStatus === 'ok';
                    if (!preflightReady) {
                        toast.info('Run GitHub import checks before continuing.');
                        return;
                    }

                    const previewReady = githubPreview.status === 'ready' && githubPreview.repoUrl === repoUrl;
                    if (!previewReady) {
                        toast.info('Continuing without full preview. Import checks passed.');
                    }
                }
                if (importType === 'upload') {
                    if (!uploadFiles || uploadFiles.length === 0) {
                        toast.error('Please select a folder first.');
                        return;
                    }
                    const metadata = (getValues('import_source.metadata') || {}) as Record<string, unknown>;
                    if (metadata.uploadValidationStatus !== 'ok') {
                        toast.error(feedbackError(String(metadata.uploadValidationError || 'Resolve blocked files before continuing.'), "Resolve blocked files before continuing."));
                        return;
                    }
                }

                isValid = true;
            } else if (phase === 2) {
                const fieldsToValidate: Array<'project_type' | 'custom_project_type' | 'title' | 'description'> = ['project_type', 'title', 'description'];
                if (getValues('project_type') === 'other') {
                    fieldsToValidate.push('custom_project_type');
                }
                setPhase2ValidationAttempted(true);
                isValid = await trigger(fieldsToValidate, { shouldFocus: true });
                const organization = getValues('organization');
                if (isValid && organization) {
                    const handle = await checkOrgHandleAction(organization.handle || '');
                    if (!handle.available) {
                        toast.error(handle.message);
                        document.getElementById('create-org-handle')?.focus();
                        isValid = false;
                    } else {
                        setValue('organization.handle', handle.handle ?? '', { shouldDirty: true });
                        isValid = await trigger(['organization'], { shouldFocus: true });
                    }
                }
                if (isValid) setPhase2ValidationAttempted(false);
            } else if (phase === 3) {
                setPhase3ValidationAttempted(true);
                isValid = await trigger(['creator_role', 'roles'], { shouldFocus: true });
                if (isValid) setPhase3ValidationAttempted(false);
            } else if (phase === 4) {
                setPhase4ValidationAttempted(true);
                if (phase4LinkComposerPending) {
                    toast.error('Finish adding the project link or clear the URL before continuing.');
                    isValid = false;
                } else {
                    isValid = (await trigger(['visibility', 'external_links'], { shouldFocus: true })) && (await trigger(['lifecycle_stages']));
                }
                if (isValid) setPhase4ValidationAttempted(false);
            } else if (phase === 5) {
                isValid = true;
            }

            if (isValid && phase < TOTAL_PHASES) {
                holdTransitionForReview = phase === TOTAL_PHASES - 1;
                if (holdTransitionForReview) setIsReviewReady(false);
                setPhase(prev => (prev + 1) as WizardPhaseId);
            }
        } finally {
            const releaseTransition = () => {
                phaseTransitionRef.current = false;
                setIsPhaseTransitioning(false);
                phaseTransitionTimerRef.current = null;
            };

            if (holdTransitionForReview) {
                phaseTransitionTimerRef.current = setTimeout(releaseTransition, 350);
            } else {
                releaseTransition();
            }
        }
    }, [phase, trigger, getValues, setValue, githubPreview.repoUrl, githubPreview.status, isSubmitting, phase4LinkComposerPending, uploadFiles]);

    const handleBack = useCallback(() => {
        if (isSubmitting || phaseTransitionRef.current) return;
        if (phase > 1) {
            setPhase(prev => (prev - 1) as WizardPhaseId);
        }
    }, [isSubmitting, phase]);

    const goToPhase = useCallback((target: WizardPhaseId) => {
        if (isSubmitting || phaseTransitionRef.current) return;
        setIsReviewReady(false);
        setPhase(target);
    }, [isSubmitting]);

    const handleCloseAttempt = useCallback(() => {
        if (hasUnsavedWizardChanges) setShowExitConfirm(true);
        else onClose();
    }, [hasUnsavedWizardChanges, onClose]);

    // --- Submission ---
    const onSubmit = useCallback(async (data: CreateProjectInput) => {
        if (phase !== TOTAL_PHASES || !isReviewReady || phaseTransitionRef.current || submissionRef.current) return;

        submissionRef.current = true;
        setIsSubmitting(true);
        const importType = data.import_source?.type || 'scratch';
        const creationToastId = toast.loading('Creating project…');
        const creationWarnings: string[] = [];
        const warnCreation = (message: string) => {
            if (!creationWarnings.includes(message)) creationWarnings.push(message);
            toast.warning('Project created', { id: creationToastId, description: creationWarnings.join(' ') });
        };
        let createdProjectId: string | null = null;
        let createdOrganization: { title: string; joinCode: string } | undefined;
        let uploadSessionContext: { sessionId?: string; manifestHash?: string } | null = null;
        const resolvedRoles = (data.roles || []).filter((role) => (role.role || '').trim().length > 0);
        const readmeIntent = data.readme ?? {
            mode: 'starter' as const,
            sourcePath: null,
            publishOnCreate: false,
            includeRoles: true,
        };
        let readmeApplied = false;

        const uploadMetadata = (data.import_source?.metadata || {}) as Record<string, unknown>;

        const applyReadmeSetup = async (projectId: string) => {
            if (readmeApplied) return;
            if (readmeIntent.mode === 'skip') {
                readmeApplied = true;
                return;
            }

            try {
                const fromTemplate = readmeIntent.orgTemplateDocId
                    ? await import('@/app/actions/org-docs').then((m) => m.readOrgTemplateCopyAction(projectId, readmeIntent.orgTemplateDocId!))
                    : null;
                if (fromTemplate && !fromTemplate.success) warnCreation('The org template could not be copied; the starter doc was used instead.');
                const starterContent = fromTemplate?.success ? fromTemplate.content : buildProjectDocStarterDraft({
                    title: data.title,
                    shortDescription: data.short_description,
                    description: data.description,
                    projectType: data.project_type === 'other'
                        ? data.custom_project_type || data.project_type
                        : data.project_type,
                    technologies: data.technologies_used || [],
                    tags: data.tags || [],
                    roles: resolvedRoles,
                    includeRoles: readmeIntent.includeRoles !== false,
                });
                // ponytail: dynamic import keeps doc server action out of initial wizard bundle. ceiling: 1 doc creation per project. upgrade: static import if wizard bundle is consolidated.
                const { applyCreationIntentAction } = await import('@/app/actions/project/doc');
                await applyCreationIntentAction(projectId, {
                    mode: readmeIntent.mode,
                    sourcePath: readmeIntent.sourcePath || null,
                    starterContent,
                    publishOnCreate: readmeIntent.publishOnCreate ?? false,
                    includeRoles: readmeIntent.includeRoles !== false,
                });
                readmeApplied = true;
            } catch (error) {
                console.warn('[create-project] Doc setup failed', error);
                warnCreation('Doc setup failed.');
            }
        };

        // Step 4 settings that need the project to exist first. Failures never undo creation;
        // both stay editable in Project settings.
        // Report §23.6: copy an org Template folder into the new project (same files, recorded as org copies).
        const copyOrgTemplateFolder = async (projectId: string, orgFolderId: string) => {
            const [{ browseOrgFilesAction, listOrgTemplateFoldersAction, recordOrgCopyAction }, { createFolder }, { uploadProjectFile }] = await Promise.all([
                import('@/app/actions/org-files'), import('@/app/actions/files/mutations'), import('@/components/organizations/OrgDocParts'),
            ]);
            let copied = 0;
            const walk = async (sourceId: string, targetId: string | null, depth: number): Promise<void> => {
                const listed = await browseOrgFilesAction(projectId, sourceId);
                if (!listed.success) throw new Error(listed.error);
                for (const node of listed.nodes) {
                    if (copied >= 100) return; // ponytail: 100 files per template; larger trees go through Files → Copy.
                    if (node.type === 'folder') {
                        if (depth < 5) await walk(node.id, (await createFolder(projectId, targetId, node.name)).id, depth + 1);
                        continue;
                    }
                    const response = await fetch(`/api/v1/projects/${listed.org.id}/files/${node.id}/preview?download=1`);
                    if (!response.ok) continue;
                    const created = await uploadProjectFile(projectId, targetId, node.name, await response.blob());
                    await recordOrgCopyAction(projectId, created.id, node.id);
                    copied += 1;
                }
            };
            const root = (await listOrgTemplateFoldersAction(data.parent_org_id!)).find((f) => f.id === orgFolderId);
            await walk(orgFolderId, (await createFolder(projectId, null, root?.name ?? 'Template')).id, 0);
        };

        const applyLaunchSettingsAfterCreate = async (projectId: string) => {
            if (data.parent_org_id && data.org_template_folder_id) {
                try {
                    await copyOrgTemplateFolder(projectId, data.org_template_folder_id);
                } catch (error) {
                    console.warn('[create-project] Org template copy failed', error);
                    warnCreation('The org template could not be copied; copy it from Files.');
                }
            }
            if (projectImage) {
                try {
                    const { uploadProjectImage } = await import('@/lib/upload/project-image-upload-client');
                    await uploadProjectImage(projectId, projectImage);
                } catch (error) {
                    console.warn('[create-project] Project picture upload failed', error);
                    warnCreation('Image upload failed.');
                }
            }
            if (readmeIntent.mode !== 'skip' && data.doc_edit_policy === 'members') {
                const { updateProjectDocSettingsAction } = await import('@/app/actions/project/doc');
                const result = await updateProjectDocSettingsAction(projectId, { editPolicy: 'members' });
                if (!result.success) warnCreation('Docs stay leaders-only.');
            }
        };

        try {
            if (importType === 'upload') {
                if (!uploadFiles || uploadFiles.length === 0) {
                    throw new Error('Please select a folder to upload.');
                }
                if (uploadMetadata.uploadValidationStatus !== 'ok') {
                    throw new Error(String(uploadMetadata.uploadValidationError || 'The selected folder contains blocked files.'));
                }
            }

            const result = await createProjectAction({
                ...data,
                roles: resolvedRoles,
            });

            if (!result.success || !result.project) throw Object.assign(new Error(result.error || 'Creation failed'), { code: (result as { code?: string }).code });
            createdProjectId = result.project.id;
            if (result.project.joinCode) createdOrganization = { title: result.project.title, joinCode: result.project.joinCode };
            // Things that didn't happen but didn't stop creation, e.g. an invitation refused by privacy rules.
            for (const notice of result.notices ?? []) warnCreation(notice);

            // Upload flow (Folder Upload import)
            if (importType === 'upload') {
                if (!uploadFiles || uploadFiles.length === 0) {
                    throw new Error('Please select a folder to upload.');
                }
                setUploadProgress({ percent: 0, currentFile: '', isUploading: true });
                toast.loading('Uploading folder…', { id: creationToastId });

                const [{ uploadFolder }, uploadActions, importActions] = await Promise.all([
                    import('@/lib/upload/chunked-upload'),
                    import('@/app/actions/upload'),
                    import('@/app/actions/upload-import'),
                ]);

                const { getUploadPresignedUrl, getBatchUploadUrls } = uploadActions;
                const { registerUploadedFolderAction, updateUploadSessionAction } = importActions;
                const uploadProjectId = createdProjectId;
                if (!uploadProjectId) {
                    throw new Error('Project creation did not return a project ID.');
                }

                const filesArr = Array.from(uploadFiles);
                const meta = filesArr.map((f) => {
                    const relativePath = f.webkitRelativePath || f.name;
                    const key = buildProjectFileKey(uploadProjectId, relativePath);
                    return {
                        key,
                        relativePath,
                        size: f.size,
                        mimeType: f.type || 'application/octet-stream',
                    };
                });
                const sessionId = globalThis.crypto?.randomUUID?.()
                    || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                const manifestHash = buildUploadManifestHash(
                    meta.map((entry) => ({
                        relativePath: entry.relativePath,
                        size: entry.size,
                        mimeType: entry.mimeType,
                    }))
                );
                const importEventId = buildProjectImportEventId({
                    projectId: uploadProjectId,
                    source: 'upload',
                    normalizedTarget: 'upload',
                    branchOrManifestHash: manifestHash,
                });
                uploadSessionContext = { sessionId, manifestHash };

                await updateUploadSessionAction(uploadProjectId, {
                    sessionId,
                    manifestHash,
                    totalFiles: meta.length,
                    uploadedFiles: 0,
                    status: 'uploading',
                    importEventId,
                });

                // Batch-cache presigned URLs up to 50 at a time to minimize server roundtrips
                const presignCache = new Map<string, {
                    url: string;
                    uploadToken: string;
                    storageKey: string;
                    uploadIntentId: string;
                }>();
                let pendingBatchPromise: Promise<void> | null = null;
                let nextBatchIndex = 0;

                const fetchNextBatch = async () => {
                    if (nextBatchIndex >= meta.length) return;
                    const batchItems = meta.slice(nextBatchIndex, nextBatchIndex + 50).map((m) => ({
                        key: m.key,
                        contentType: m.mimeType,
                        sizeBytes: m.size,
                    }));
                    nextBatchIndex += 50;

                    try {
                        const res = await getBatchUploadUrls(batchItems, { sessionId });
                        if (!('error' in res)) {
                            for (const item of batchItems) {
                                const url = res.urls[item.key];
                                const uploadToken = res.uploadTokens[item.key];
                                const storageKey = res.storageKeys[item.key];
                                const uploadIntentId = res.uploadIntentIds[item.key];
                                if (url && storageKey && uploadIntentId) {
                                    presignCache.set(item.key, {
                                        url,
                                        uploadToken: uploadToken || '',
                                        storageKey,
                                        uploadIntentId,
                                    });
                                }
                            }
                        }
                    } catch {
                        // Fall back transparently to single presign on batch failure
                    }
                };

                const getPresignedUrl = async (key: string, contentType: string, sizeBytes: number) => {
                    if (presignCache.has(key)) {
                        return presignCache.get(key)!;
                    }

                    while (!presignCache.has(key) && nextBatchIndex < meta.length) {
                        if (!pendingBatchPromise) {
                            pendingBatchPromise = fetchNextBatch().finally(() => {
                                pendingBatchPromise = null;
                            });
                        }
                        await pendingBatchPromise;
                        if (presignCache.has(key)) {
                            return presignCache.get(key)!;
                        }
                    }

                    if (presignCache.has(key)) {
                        return presignCache.get(key)!;
                    }

                    const single = await getUploadPresignedUrl(key, contentType, sizeBytes, { sessionId });
                    if ('error' in single) throw new Error(single.error);
                    return {
                        url: single.url,
                        uploadToken: single.token,
                        storageKey: single.storageKey,
                        uploadIntentId: single.uploadIntentId,
                    };
                };

                const uploadRes = await uploadFolder(
                    uploadFiles,
                    uploadProjectId,
                    (p) => {
                        setUploadProgress({
                            percent: p.percent,
                            currentFile: p.currentFile,
                            isUploading: p.percent < 100,
                        });
                    },
                    getPresignedUrl,
                    {
                        sessionId,
                        manifestHash,
                    }
                );

                // Register ONLY successfully uploaded files so Files tab never references missing keys
                const uploadedByRequestKey = new Map(
                    uploadRes.uploadedAssets.map((asset) => [asset.requestKey, asset]),
                );
                const manifest = meta
                    .map((m) => {
                        const uploaded = uploadedByRequestKey.get(m.key);
                        if (!uploaded) return null;
                        return {
                            relativePath: m.relativePath,
                            size: m.size,
                            mimeType: m.mimeType,
                            storageKey: uploaded.storageKey,
                            uploadIntentId: uploaded.uploadIntentId,
                        };
                    })
                    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

                await updateUploadSessionAction(uploadProjectId, {
                    sessionId,
                    manifestHash,
                    totalFiles: meta.length,
                    uploadedFiles: manifest.length,
                    status: 'registering',
                    importEventId,
                });

                const registerResult = await registerUploadedFolderAction(uploadProjectId, manifest, {
                    sessionId,
                    manifestHash,
                    reconcilePolicy: 'mirror',
                });
                if (!registerResult.success) {
                    if (registerResult.skipped) {
                        const ownerInfo = registerResult.lockOwnerSessionId
                            ? ` (active session: ${registerResult.lockOwnerSessionId})`
                            : '';
                        toast.loading('Registering uploaded files…', { id: creationToastId });
                    } else {
                        throw new Error('Failed to register uploaded files.');
                    }
                }

                await applyReadmeSetup(uploadProjectId);
                setUploadProgress({ percent: 100, currentFile: '', isUploading: false });

                if (!uploadRes.success) {
                    warnCreation(`${uploadRes.failedFiles.length} files failed.`);
                } else {
                    // Final outcome resolves the same card after post-create setup.
                }
            } else {
                if (createdProjectId) {
                    await applyReadmeSetup(createdProjectId);
                }
                // Post-create setup determines the final outcome.
            }

            if (createdProjectId && !readmeApplied) {
                await applyReadmeSetup(createdProjectId);
            }
            if (createdProjectId) await applyLaunchSettingsAfterCreate(createdProjectId);
            if (!creationWarnings.length) toast.success(importType === 'upload' ? 'Project & files ready' : 'Project created', { id: creationToastId });

            const { draftStore } = await import('@/lib/storage/draft-store');
            await draftStore.clear(userId);
            skipDraftOnUnmountRef.current = true;
            // Success navigates to the new project; closing as well would navigate away from it.
            if (createdProjectId && onSuccess) onSuccess(createdProjectId, createdOrganization);
            else onClose();
        } catch (error: any) {
            // If upload import failed after project creation, mark syncStatus=failed so Files tab can show retry UI.
            try {
                if (createdProjectId && importType === 'upload') {
                    const { markProjectSyncFailedAction } = await import('@/app/actions/upload-import');
                    await markProjectSyncFailedAction(createdProjectId, {
                        sessionId: uploadSessionContext?.sessionId,
                        manifestHash: uploadSessionContext?.manifestHash,
                        reason: error?.message || 'Upload import failed',
                    });
                }
            } catch { }
            if (createdProjectId) warnCreation('Some setup needs attention.');
            else if (error?.code === 'ORG_BLOCKED') {
                // Report §14.6: everything entered stays; the person can make it a personal project instead.
                toast.error(error.message, {
                    id: creationToastId,
                    action: {
                        label: 'Create as a personal project',
                        onClick: () => {
                            setValue('parent_org_id', undefined);
                            setValue('lead_user_id', undefined);
                            if (getValues('visibility') === 'org') setValue('visibility', 'private');
                            void onSubmitRef.current?.(getValues());
                        },
                    },
                });
            }
            else toast.error(feedbackError(error.message || 'Failed to create project', 'Failed to create project'), { id: creationToastId });
        } finally {
            submissionRef.current = false;
            setIsSubmitting(false);
        }
    }, [onSuccess, onClose, phase, isReviewReady, uploadFiles, projectImage]);
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;

    return {
        phase, methods, wizardContext, isSubmitting, isSavingDraft, phase2ValidationAttempted, phase3ValidationAttempted, phase4ValidationAttempted,
        phase4LinkComposerPending, setPhase4LinkComposerPending,
        isPhaseTransitioning, isReviewReady, setIsReviewReady,
        uploadFiles, setUploadFiles, uploadProgress, setUploadProgress, projectImage, setProjectImage,
        saveStatus, lastSaved, showExitConfirm, setShowExitConfirm,
        handleNext, handleBack, goToPhase, saveDraft, handleCloseAttempt, markLeaving, hasUnsavedWizardChanges,
        githubPreview,
        githubFolderEntries,
        loadGithubFolder,
        startGithubRootPreview,
        onSubmit, draftInfo, restoreDraft, deleteDraft
    };
}
