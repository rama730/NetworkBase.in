'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useWatch } from 'react-hook-form';
import { Save } from 'lucide-react';
import dynamic from 'next/dynamic';

import { TOTAL_PHASES, WIZARD_PHASES } from '@/constants/project-wizard';
import { toast } from '@/lib/feedback';

// Hook
import { useCreateProjectWizard } from './useCreateProjectWizard';

// Shared Components
import WizardHeader from './WizardHeader';
import WizardFooter, { WIZARD_COLUMN } from './WizardFooter';
import { Button } from '@/components/ui/button';
import LeaveProjectSetupDialog from './LeaveProjectSetupDialog';
import { getCreateProjectReturnPath, readGithubOAuthResume, type CreateProjectGithubOAuthResume } from './github-oauth-resume';

// Dynamic Phase Imports with Consistent Loading States
const PhaseLoadingPlaceholder = () => (
    <div className="min-w-0 w-full space-y-5" aria-label="Loading phase" role="status">
        <div aria-hidden="true" className="nb-skeleton h-5 w-48 rounded-sm" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} aria-hidden="true" className="nb-skeleton h-32 rounded-lg border border-border" />)}
        </div>
        <div aria-hidden="true" className="nb-skeleton h-56 rounded-lg border border-border" />
    </div>
);

const Phase1SourceSelection = dynamic(() => import('./phases/Phase1SourceSelection'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase2Information = dynamic(() => import('./phases/Phase2Information'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase3TeamRoles = dynamic(() => import('./phases/Phase3TeamRoles'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase4Settings = dynamic(() => import('./phases/Phase4Settings'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase5Review = dynamic(() => import('./phases/Phase5Review'), { loading: PhaseLoadingPlaceholder, ssr: false });

interface Props {
    onClose: () => void;
    onSuccess?: (projectId: string) => void;
    initialSource?: 'scratch' | 'github' | 'upload' | null;
    onSourceChange?: (source: 'scratch' | 'github' | 'upload' | null) => void;
    githubOAuthResume?: CreateProjectGithubOAuthResume | null;
    onGithubOAuthResumeRestored?: (resumeId: string) => void;
}

export default function CreateProjectWizard({ onClose, onSuccess, initialSource = null, onSourceChange, githubOAuthResume = null, onGithubOAuthResumeRestored }: Props) {
    const {
        phase, methods, wizardContext, isSubmitting, isSavingDraft, phase2ValidationAttempted, phase3ValidationAttempted, phase4ValidationAttempted,
        phase4LinkComposerPending, setPhase4LinkComposerPending, isPhaseTransitioning, isReviewReady, setIsReviewReady,
        uploadFiles, setUploadFiles, uploadProgress, projectImage, setProjectImage,
        githubPreview, githubFolderEntries, loadGithubFolder, startGithubRootPreview,
        saveStatus, lastSaved, showExitConfirm, setShowExitConfirm,
        handleNext, handleBack, goToPhase, saveDraft, handleCloseAttempt, markLeaving, hasUnsavedWizardChanges,
        onSubmit, draftInfo, restoreDraft, deleteDraft
    } = useCreateProjectWizard({
        onClose,
        onSuccess,
        initialValues: githubOAuthResume?.values,
        initialPhase: 1,
    });

    const { handleSubmit } = methods;
    const scrollBodyRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const restoredGithubOAuthResumeRef = useRef<string | null>(null);
    const [isResumingGithubOAuth] = useState(Boolean(githubOAuthResume));
    const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);

    useEffect(() => {
        if (methods.formState.isDirty) {
            setDraftBannerDismissed(true);
        }
    }, [methods.formState.isDirty]);

    const handleReviewReady = useCallback(() => setIsReviewReady(true), [setIsReviewReady]);

    const handleInvalid = useCallback((errors: Record<string, any>) => {
        const getFirstError = (errObj: Record<string, any>): string | null => {
            for (const key of Object.keys(errObj)) {
                const err = errObj[key];
                if (!err) continue;
                if (typeof err.message === 'string' && err.message) return err.message;
                if (typeof err === 'object') {
                    const nested = getFirstError(err);
                    if (nested) return nested;
                }
            }
            return null;
        };
        const firstMsg = getFirstError(errors) || 'Please complete all required fields before creating.';
        toast.error('Please complete required fields before creating', { description: firstMsg });
    }, []);
    // Subscribe, don't watch(): Phase 1 replaces the whole import_source object, which react-hook-form
    // does not re-render this component for. A stale type kept Continue greyed out after GitHub -> Scratch.
    const [sourceType, sourceRepoUrl, rawSourceMetadata] = useWatch({
        control: methods.control,
        name: ['import_source.type', 'import_source.repoUrl', 'import_source.metadata'],
    });
    const sourceMetadata = rawSourceMetadata as Record<string, unknown> | undefined;

    useEffect(() => {
        if (!githubOAuthResume || restoredGithubOAuthResumeRef.current === githubOAuthResume.id) return;
        restoredGithubOAuthResumeRef.current = githubOAuthResume.id;
        onGithubOAuthResumeRestored?.(githubOAuthResume.id);
    }, [githubOAuthResume, onGithubOAuthResumeRestored]);

    const phase1NextLabel = (() => {
        if (phase !== 1) return undefined;
        const t = sourceType;
        if (t !== 'github') return undefined;
        const url = (sourceRepoUrl || '').trim();
        if (!url) return 'Continue';
        return 'Continue';
    })();

    const phase1NextDisabled = (() => {
        if (phase !== 1) return false;
        const t = sourceType;
        if (!t) {
            return true;
        }
        if (t === 'github') {
            const url = (sourceRepoUrl || '').trim();
            if (!url) return true;
            return sourceMetadata?.githubPreflightStatus !== 'ok';
        }

        if (t === 'upload') {
            return !uploadFiles || uploadFiles.length === 0 || sourceMetadata?.uploadValidationStatus !== 'ok';
        }

        return false;
    })();

    const phase1NextDisabledReason = phase !== 1 || !phase1NextDisabled
        ? undefined
        : sourceType === 'github'
            ? sourceRepoUrl?.trim()
                ? 'Load a valid repository preview to continue.'
                : 'Choose or paste a repository to continue.'
            : sourceType === 'upload'
                ? uploadFiles?.length
                    ? String(sourceMetadata?.uploadValidationError || 'Resolve blocked files to continue.')
                    : 'Choose a folder to continue.'
                : 'Choose a starting point to continue.';

    // OPTIMIZATION: Prefetch next phase component to eliminate loading delay
    useEffect(() => {
        if (phase === 1) import('./phases/Phase2Information');
        else if (phase === 2) import('./phases/Phase3TeamRoles');
        else if (phase === 3) import('./phases/Phase4Settings');
        else if (phase === 4) import('./phases/Phase5Review');
    }, [phase]);

    useEffect(() => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scrollBodyRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        // Shift keyboard focus on phase change so screen readers announce the new step
        const timer = setTimeout(() => {
            const phaseHeading = scrollBodyRef.current?.querySelector<HTMLElement>('h2, h3, [data-phase-heading]');
            if (phaseHeading) {
                phaseHeading.setAttribute('tabindex', '-1');
                phaseHeading.focus({ preventScroll: true });
            } else {
                headingRef.current?.focus({ preventScroll: true });
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [phase]);

    // Refresh or tab close with unsaved work gets the browser's own prompt. The GitHub sign-in
    // hand-off is exempt: it snapshots the form first and restores it on return.
    useEffect(() => {
        if (!hasUnsavedWizardChanges) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (readGithubOAuthResume(getCreateProjectReturnPath(window.location))) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [hasUnsavedWizardChanges]);

    // No Esc-to-close: this is a page, not a dialog, and a stray Esc must not drop a 5-step form. Cancel is explicit.

    const draftPhaseLabel = draftInfo ? WIZARD_PHASES[draftInfo.phase - 1]?.label : undefined;

    const content = (
            // A normal page in the app shell (spec §18): fills the main content area; header and footer bands, one scrolling body.
            <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-card motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
                    <FormProvider {...methods}>
                        {/* Header */}
                        <WizardHeader
                            currentPhase={phase}
                            onClose={handleCloseAttempt}
                            onStepSelect={goToPhase}
                            stepsDisabled={isSubmitting || isPhaseTransitioning}
                            headingRef={headingRef}
                        />

                        {/* Draft recovery: a choice to make before starting, so it sits above the form, not above the footer. */}
                        {draftInfo?.exists && !draftBannerDismissed && (
                            <div className="flex-shrink-0 border-b border-border bg-secondary/45">
                                <div className={`${WIZARD_COLUMN} flex items-center justify-between gap-4 px-4 py-4 md:px-6 max-sm:flex-col max-sm:items-stretch max-sm:gap-3`}>
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-card">
                                            <Save className="size-4 text-muted-foreground" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="nb-card-title truncate text-foreground">
                                                Continue your saved draft?
                                            </p>
                                            <p className="nb-meta text-muted-foreground">
                                                Stopped at step {draftInfo.phase}{draftPhaseLabel ? ` · ${draftPhaseLabel}` : ''}{draftInfo.savedAt ? ` · ${draftInfo.savedAt.toLocaleDateString()}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-shrink-0 items-center gap-2 max-sm:grid max-sm:grid-cols-3">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() => setDraftBannerDismissed(true)}
                                        >
                                            Start fresh
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={deleteDraft}
                                        >
                                            Delete draft
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={restoreDraft}
                                        >
                                            Continue draft
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}


                        {/* Content */}
                        <div ref={scrollBodyRef} data-wizard-scroll className="app-scroll app-scroll-y app-scroll-gutter min-h-0 flex-1 scroll-pb-32 overflow-y-auto overscroll-contain">
                        <div className={`${WIZARD_COLUMN} px-4 pb-6 pt-5 md:px-6 md:py-8`}>
                            {uploadProgress?.isUploading && (
                                <div className="mb-4 rounded-lg border border-border bg-secondary/45 p-4" role="status" aria-live="polite">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="nb-card-title text-foreground">
                                                Importing files…
                                            </div>
                                            <div className="nb-meta truncate text-muted-foreground">
                                                {uploadProgress.currentFile || 'Preparing uploads'}
                                            </div>
                                        </div>
                                        <div className="text-sm font-semibold text-primary shrink-0 tabular-nums">
                                            {uploadProgress.percent}%
                                        </div>
                                    </div>
                                    <div className="mt-3 h-1.5 overflow-hidden rounded-sm bg-muted">
                                        <div
                                            className="h-full bg-primary transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[180ms]"
                                            style={{ width: `${uploadProgress.percent}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                            <form
                                id="create-project-form"
                                onSubmit={handleSubmit(onSubmit as any, handleInvalid)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'submit') {
                                        e.preventDefault();
                                    }
                                }}
                                className="space-y-8"
                            >
                                <div key={phase}>
                                        {phase === 1 && (
                                            <Phase1SourceSelection
                                                uploadFiles={uploadFiles}
                                                setUploadFiles={setUploadFiles}
                                                githubPreview={githubPreview}
                                                githubFolderEntries={githubFolderEntries}
                                                loadGithubFolder={loadGithubFolder}
                                                startGithubRootPreview={startGithubRootPreview}
                                                initialSource={isResumingGithubOAuth ? 'github' : initialSource}
                                                onSourceChange={onSourceChange}
                                                isResumingGithubOAuth={isResumingGithubOAuth}
                                            />
                                        )}
                                        {phase === 2 && <Phase2Information showValidationSummary={phase2ValidationAttempted} />}
                                        {phase === 3 && <Phase3TeamRoles wizardContext={wizardContext} showValidationSummary={phase3ValidationAttempted} />}
                                        {phase === 4 && <Phase4Settings showValidationSummary={phase4ValidationAttempted} linkComposerPending={phase4LinkComposerPending} onLinkComposerPending={setPhase4LinkComposerPending} projectImage={projectImage} onProjectImageChange={setProjectImage} />}
                                        {phase === 5 && <Phase5Review goToPhase={goToPhase} onReady={handleReviewReady} projectImage={projectImage} />}
                                </div>
                            </form>
                        </div>
                        </div>

                        {/* Footer */}
                        <div className="flex-shrink-0">
                            <WizardFooter
                                phase={phase}
                                totalPhases={TOTAL_PHASES}
                                onNext={handleNext}
                                onBack={handleBack}
                                onSaveDraft={() => saveDraft()}
                                isSubmitting={isSubmitting}
                                isSavingDraft={isSavingDraft}
                                saveStatus={saveStatus}
                                lastSaved={lastSaved}
                                isPhaseTransitioning={isPhaseTransitioning}
                                isReviewReady={isReviewReady}
                                nextLabel={phase1NextLabel}
                                nextDisabled={phase1NextDisabled}
                                nextDisabledReason={phase1NextDisabledReason}
                            />
                        </div>
                    </FormProvider>

                </div>
    );
    const leaveSetup = () => {
        markLeaving();
        onClose();
    };

    return (
        <>
            {content}
            <LeaveProjectSetupDialog
                open={showExitConfirm}
                onOpenChange={setShowExitConfirm}
                onLeave={leaveSetup}
            />
        </>
    );
}
