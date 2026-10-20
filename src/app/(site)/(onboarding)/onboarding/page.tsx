'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout'
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar'
import { MobileProgressBar } from '@/components/onboarding/MobileProgressBar'
import { StepHeader } from '@/components/onboarding/StepHeader'
import { StepFooter } from '@/components/onboarding/StepFooter'
import { FinishScreen } from '@/components/onboarding/FinishScreen'
import { Step1Identity } from '@/components/onboarding/steps/Step1Identity'
import Step2Details from '@/components/onboarding/steps/Step2Details'
import Step3Skills from '@/components/onboarding/steps/Step3Skills'
import { Step4Privacy, type ReviewSummaryItem } from '@/components/onboarding/steps/Step4Privacy'
import { useOnboardingBootstrap } from '@/components/onboarding/OnboardingBootstrapProvider'
import { commitOnboardingStep, completeOnboarding } from '@/app/actions/onboarding'
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from '@/app/actions/profile'
import { useAuth } from '@/hooks/use-auth'
import { blockReason, type UsernameCheck } from '@/lib/onboarding/block-reason'
import {
    ONBOARDING_TOTAL_STEPS as TOTAL_STEPS,
    VISIBILITY_CHOICES,
    MESSAGE_PRIVACY_CHOICES,
    type OnboardingSocialLinkKey,
} from '@/lib/onboarding/contracts'
import type { OnboardingEventInput } from '@/lib/onboarding/events'
import { EMPTY_ONBOARDING_DATA, applyDraft, toDraftPayload, toggleIn, type OnboardingData } from '@/lib/onboarding/form-data'
import {
    ONBOARDING_LOCAL_DRAFT_TTL_MS,
    ONBOARDING_SCHEMA_VERSION,
    clampCompletedThrough,
    clampOnboardingStep,
    onboardingStorageKeys,
} from '@/lib/onboarding/state'
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'
import { isSafeHttpUrl } from '@/lib/security/urls'
import { compressAvatarOffMainThread } from '@/lib/services/avatar-worker-client'
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client'
import { parseOnboardingDraft } from '@/lib/validations/onboarding'
import { Loader2 } from 'lucide-react'

const SIDEBAR_STEPS = STEP_UI_CONFIG.map((config) => ({ title: config.sidebarLabel, subtitle: config.railHint }))
const MOBILE_LABELS = STEP_UI_CONFIG.map((config) => config.sidebarLabel)
const AVATAR_MAX_PICK_BYTES = 15 * 1024 * 1024
const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const USERNAME_CODES = new Set(['USERNAME_TAKEN', 'USERNAME_INVALID', 'USERNAME_RESERVED'])

/** The crash buffer: what the person typed, kept in this browser so a refresh or a lost connection costs nothing. */
function readStoredDraft(key: string, userId: string) {
    try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Record<string, unknown> | null
        const valid =
            parsed &&
            parsed.userId === userId &&
            parsed.schemaVersion === ONBOARDING_SCHEMA_VERSION &&
            typeof parsed.expiresAt === 'number' &&
            parsed.expiresAt > Date.now()
        if (!valid) {
            window.localStorage.removeItem(key)
            return null
        }
        return {
            step: clampOnboardingStep(parsed.step),
            completedThrough: clampCompletedThrough(parsed.completedThrough),
            baseVersion: typeof parsed.baseVersion === 'number' ? parsed.baseVersion : 0,
            draft: parseOnboardingDraft(parsed.data),
        }
    } catch {
        return null
    }
}

/** `?next=` after a full unwrap: a nested /onboarding?next=/x resolves to /x, and onboarding itself resolves to Discover. */
function resolveReturnPath() {
    let path = normalizeAuthNextPath(new URLSearchParams(window.location.search).get('next'))
    if (path === '/onboarding' || path.startsWith('/onboarding?')) {
        const inner = new URLSearchParams(path.split('?')[1] ?? '').get('next')
        path = inner ? normalizeAuthNextPath(inner) : '/discover'
    }
    return path === '/onboarding' || path.startsWith('/onboarding?') ? '/discover' : path
}

export default function OnboardingPage() {
    const bootstrap = useOnboardingBootstrap()
    const { user, profile } = useAuth()
    const storageKey = onboardingStorageKeys(bootstrap.userId).draft

    const [data, setData] = useState<OnboardingData>(() => {
        const merged = applyDraft(EMPTY_ONBOARDING_DATA, bootstrap.draft.data)
        const metadata = user?.user_metadata ?? {}
        const accountAvatar = [profile?.avatarUrl, metadata.avatar_url, metadata.picture].find(
            (url): url is string => typeof url === 'string' && isSafeHttpUrl(url),
        )
        return {
            ...merged,
            fullName: merged.fullName || profile?.fullName || metadata.full_name || metadata.name || '',
            avatarUrl: merged.avatarUrl || accountAvatar || '',
        }
    })
    const [step, setStep] = useState(() => clampOnboardingStep(bootstrap.draft.step))
    const [completedThrough, setCompletedThrough] = useState(() => clampCompletedThrough(bootstrap.draft.completedThrough))
    // The browser's own copy is only readable on the client, so the form waits for it instead of flashing server state first.
    const [ready, setReady] = useState(false)
    const [busy, setBusy] = useState(false)
    const [finished, setFinished] = useState(false)
    const [continuePath, setContinuePath] = useState('/discover')
    const [error, setError] = useState<string | null>(null)
    const [commitFailed, setCommitFailed] = useState(false)
    const [conflictNotice, setConflictNotice] = useState(false)
    const [showErrors, setShowErrors] = useState(false)
    const [returnToReview, setReturnToReview] = useState(false)
    const [usernameCheck, setUsernameCheck] = useState<UsernameCheck>({ username: '', status: 'idle' })
    const [usernameServerError, setUsernameServerError] = useState<string | null>(null)
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
    const [avatarMessage, setAvatarMessage] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)
    const [isDetectingLocation, setIsDetectingLocation] = useState(false)
    const [locationError, setLocationError] = useState<string | null>(null)

    const versionRef = useRef(bootstrap.draft.version)
    const queueRef = useRef<OnboardingEventInput[]>([])
    const previewUrlRef = useRef<string | null>(null)
    const previousStepRef = useRef<number | null>(null)
    const anchorRef = useRef<string | null>(null)

    const track = useCallback((eventType: OnboardingEventInput['eventType'], eventStep: number) => {
        queueRef.current.push({ eventType, step: eventStep })
        if (queueRef.current.length > 25) queueRef.current.shift()
    }, [])

    // Reconcile with the crash buffer once: it wins only when it is at least as new as the server's draft.
    useEffect(() => {
        const local = readStoredDraft(storageKey, bootstrap.userId)
        if (local && local.baseVersion >= bootstrap.draft.version) {
            setStep(local.step)
            setCompletedThrough(local.completedThrough)
            setData((current) => applyDraft(current, local.draft))
        }
        setReady(true)
    }, [])

    useEffect(() => {
        if (!ready || finished) return
        try {
            window.localStorage.setItem(
                storageKey,
                JSON.stringify({
                    userId: bootstrap.userId,
                    step,
                    completedThrough,
                    baseVersion: versionRef.current,
                    schemaVersion: ONBOARDING_SCHEMA_VERSION,
                    data: toDraftPayload(data),
                    expiresAt: Date.now() + ONBOARDING_LOCAL_DRAFT_TTL_MS,
                }),
            )
        } catch {
            // Storage can be full or blocked; the server still has every committed step.
        }
    }, [bootstrap.userId, completedThrough, data, finished, ready, step, storageKey])

    // A step change starts at the top, with focus on its heading (or on the part being edited).
    useEffect(() => {
        if (!ready) return
        const changed = previousStepRef.current !== null && previousStepRef.current !== step
        previousStepRef.current = step
        track('step_view', step)
        if (!changed) return
        const anchor = anchorRef.current ? document.getElementById(anchorRef.current) : null
        anchorRef.current = null
        if (anchor) {
            anchor.scrollIntoView({ block: 'start' })
            anchor.focus({ preventScroll: true })
            return
        }
        window.scrollTo({ top: 0 })
        document.querySelector<HTMLElement>('[data-step-header]')?.focus({ preventScroll: true })
    }, [ready, step, track])

    useEffect(() => {
        return () => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        }
    }, [])

    const update = useCallback((updates: Partial<OnboardingData>) => setData((current) => ({ ...current, ...updates })), [])

    const handleAvatarPick = async (file: File) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setAvatarMessage({ kind: 'error', text: 'Choose a JPG, PNG or WebP image.' })
            return
        }
        if (file.size > AVATAR_MAX_PICK_BYTES) {
            setAvatarMessage({ kind: 'error', text: 'That image is over 15 MB. Choose a smaller one.' })
            return
        }

        const previousAvatarUrl = data.avatarUrl
        setIsUploadingAvatar(true)
        setAvatarMessage(null)
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        const previewUrl = URL.createObjectURL(file)
        previewUrlRef.current = previewUrl
        update({ avatarUrl: previewUrl })

        try {
            // The limit applies to what is uploaded, after compression: a large phone photo is fine.
            const compressed = await compressAvatarOffMainThread(file)
            if (compressed.size > AVATAR_MAX_UPLOAD_BYTES) throw new Error('Photo is still over 2 MB after compression')
            const session = await createProfileImageUploadUrlAction({ mimeType: 'image/jpeg', sizeBytes: compressed.size, kind: 'avatar' })
            if (!session.success) throw new Error(session.error || 'Failed to prepare avatar upload')
            await uploadToSupabaseSignedUrl(session, compressed, { cacheProfile: 'public' })
            const finalized = await finalizeProfileImageUploadAction({ uploadIntentId: session.uploadIntentId })
            if (!finalized.success) throw new Error(finalized.error || 'Failed to finalize avatar upload')
            update({ avatarUrl: finalized.publicUrl })
            setAvatarMessage({ kind: 'status', text: 'Photo uploaded. You can replace it before finishing.' })
        } catch (uploadError) {
            console.error('Avatar error:', uploadError)
            update({ avatarUrl: previousAvatarUrl })
            setAvatarMessage({ kind: 'error', text: 'We could not upload that photo. Your previous photo is unchanged.' })
        } finally {
            URL.revokeObjectURL(previewUrl)
            previewUrlRef.current = null
            setIsUploadingAvatar(false)
        }
    }

    const detectLocation = async () => {
        setIsDetectingLocation(true)
        setLocationError(null)
        try {
            const { detectLocation: detect } = await import('@/lib/services/location-service')
            const { location, error: detectError } = await detect()
            if (location) update({ location: location.formatted.slice(0, 120) })
            else if (detectError) setLocationError(detectError)
        } catch {
            setLocationError('We could not determine your location. You can enter it manually.')
        } finally {
            setIsDetectingLocation(false)
        }
    }

    const reason = blockReason(step, data, usernameCheck, isUploadingAvatar)

    const goToStep = (target: number, anchor?: string) => {
        if (busy || target < 1 || target > TOTAL_STEPS) return
        setError(null)
        setShowErrors(false)
        setConflictNotice(false)
        // Leaving the review to fix something: the main button then brings the person straight back to it.
        setReturnToReview(step === TOTAL_STEPS && target < TOTAL_STEPS)
        anchorRef.current = anchor ?? null
        setStep(target)
    }

    const goBack = () => {
        if (busy || step <= 1) return
        track('step_back', step)
        setError(null)
        setShowErrors(false)
        setConflictNotice(false)
        setReturnToReview(false)
        setStep(step - 1)
    }

    const advance = async (skip: boolean) => {
        if (busy) return
        if (reason) {
            setShowErrors(true)
            return
        }
        setBusy(true)
        setError(null)
        setCommitFailed(false)
        setUsernameServerError(null)
        const from = step
        track(skip ? 'step_skip' : 'step_continue', from)
        const events = queueRef.current.slice()
        try {
            const result = await commitOnboardingStep({
                step: from,
                draft: toDraftPayload(data),
                expectedVersion: versionRef.current,
                telemetry: events,
            })

            if (!result.success) {
                const code = result.errorDetails.code
                if (code === 'DRAFT_CONFLICT') {
                    // Another tab saved first: take its answers, say so, and let the person look before going on.
                    versionRef.current = result.version ?? versionRef.current
                    if (result.draft) setData((current) => applyDraft(current, result.draft!))
                    if (typeof result.step === 'number') setStep(result.step)
                    if (typeof result.committedThrough === 'number') setCompletedThrough(result.committedThrough)
                    setConflictNotice(true)
                    track('draft_conflict', from)
                } else if (USERNAME_CODES.has(code)) {
                    setUsernameServerError(result.errorDetails.message)
                } else {
                    setCommitFailed(code === 'DB_ERROR')
                    setError(result.errorDetails.message)
                }
                return
            }

            versionRef.current = result.version
            queueRef.current.splice(0, events.length)
            setCompletedThrough(result.committedThrough)
            const target = returnToReview ? TOTAL_STEPS : from + 1
            setReturnToReview(false)
            setShowErrors(false)
            setStep(target)
        } catch (commitError) {
            console.error('Unable to commit onboarding step:', commitError)
            setCommitFailed(true)
            setError('Unable to save this step right now. Your entries are kept in this browser; try again.')
        } finally {
            setBusy(false)
        }
    }

    const finish = async () => {
        if (busy) return
        if (reason) {
            setShowErrors(true)
            return
        }
        setBusy(true)
        setError(null)
        const events = queueRef.current.slice()
        try {
            const result = await completeOnboarding({ ...toDraftPayload(data), telemetry: events })
            if (!result.success) {
                const details = result.errorDetails
                if (details && USERNAME_CODES.has(details.code)) {
                    // Taken in the meantime: back to the name, with the reason beside it.
                    setUsernameServerError(details.message)
                    anchorRef.current = 'username'
                    setReturnToReview(true)
                    setStep(1)
                } else {
                    setError(result.error || 'We could not finish your setup. Please try again.')
                }
                return
            }
            queueRef.current.splice(0, events.length)
            try {
                window.localStorage.removeItem(storageKey)
            } catch {
                // nothing to clean up if storage is unavailable
            }
            setContinuePath(resolveReturnPath())
            setCompletedThrough(TOTAL_STEPS)
            setFinished(true)
        } catch (submitError) {
            console.error('Unable to complete onboarding:', submitError)
            setError('Something went wrong while finishing. Please try again.')
        } finally {
            setBusy(false)
        }
    }

    if (!ready) {
        return (
            <OnboardingLayout>
                <div className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
                    <span className="sr-only">Loading your saved progress.</span>
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                </div>
            </OnboardingLayout>
        )
    }

    if (finished) {
        return (
            <OnboardingLayout
                sidebar={<OnboardingSidebar currentStep={0} stepLabels={SIDEBAR_STEPS} completedThrough={TOTAL_STEPS} />}
            >
                <FinishScreen
                    fullName={data.fullName}
                    username={data.username}
                    headline={data.headline}
                    avatarUrl={data.avatarUrl}
                    skills={data.skills}
                    visibility={data.visibility}
                    continueLabel={continuePath === '/discover' ? 'Go to Discover' : 'Continue'}
                    onContinue={() => window.location.assign(continuePath)}
                />
            </OnboardingLayout>
        )
    }

    const config = STEP_UI_CONFIG[step - 1]!
    const hasValue = (value: string) => value.trim().length > 0
    const count = (n: number, noun: string) => (n > 0 ? `${n} ${noun}` : 'None yet')
    const linkCount = Object.values(data.socialLinks).filter(hasValue).length
    const summaryItems: ReviewSummaryItem[] = [
        { label: 'Name', value: `${data.fullName} (@${data.username})`, onEdit: () => goToStep(1) },
        { label: 'Photo', value: data.avatarUrl ? 'Added' : 'Not added', onEdit: () => goToStep(1) },
        { label: 'Headline', value: data.headline.trim() || 'Not added', onEdit: () => goToStep(2, 'onb-profile') },
        { label: 'Bio', value: data.bio.trim() ? `${data.bio.trim().length} characters` : 'Not added', onEdit: () => goToStep(2, 'onb-profile') },
        { label: 'Open to roles', value: count(data.openTo.length, 'selected'), onEdit: () => goToStep(2, 'onb-work') },
        { label: 'Social links', value: count(linkCount, 'added'), onEdit: () => goToStep(2, 'onb-social') },
        { label: 'Skills', value: count(data.skills.length, 'selected'), onEdit: () => goToStep(3) },
        { label: 'Interests', value: count(data.interests.length, 'selected'), onEdit: () => goToStep(3) },
        { label: 'Visibility', value: VISIBILITY_CHOICES.find((choice) => choice.value === data.visibility)?.label ?? '' },
        { label: 'Messages', value: MESSAGE_PRIVACY_CHOICES.find((choice) => choice.value === data.messagePrivacy)?.label ?? '' },
    ]

    const isFinalStep = step === TOTAL_STEPS
    const nextLabel = isFinalStep ? 'Finish setup' : returnToReview ? 'Back to review' : 'Continue'

    return (
        <OnboardingLayout
            sidebar={
                <OnboardingSidebar
                    currentStep={step}
                    stepLabels={SIDEBAR_STEPS}
                    completedThrough={completedThrough}
                    onSelectStep={goToStep}
                />
            }
            mobileProgress={
                <MobileProgressBar
                    currentStep={step}
                    totalSteps={TOTAL_STEPS}
                    stepLabels={MOBILE_LABELS}
                    completedThrough={completedThrough}
                    onSelectStep={goToStep}
                />
            }
        >
            <form
                noValidate
                onSubmit={(event) => {
                    event.preventDefault()
                    void (isFinalStep ? finish() : advance(false))
                }}
            >
                <div key={step} className="onb-step-enter">
                    <StepHeader title={config.title} subtitle={config.subtitle} step={step} totalSteps={TOTAL_STEPS} />

                    {conflictNotice ? (
                        <p role="status" className="mb-6 rounded-md border border-border bg-muted px-3 py-2 text-[13px] text-foreground">
                            This draft was saved from another tab. We loaded its latest answers; check them, then continue.
                        </p>
                    ) : null}

                    {/* Locked while a save is in flight, so nothing typed in that moment is silently left out. */}
                    <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
                        {step === 1 && (
                            <Step1Identity
                                fullName={data.fullName}
                                username={data.username}
                                avatarUrl={data.avatarUrl}
                                isUploadingAvatar={isUploadingAvatar}
                                avatarMessage={avatarMessage}
                                usernameServerError={usernameServerError}
                                showErrors={showErrors}
                                onFullNameChange={(fullName) => update({ fullName })}
                                onUsernameChange={(username) => {
                                    setUsernameServerError(null)
                                    update({ username })
                                }}
                                onAvatarPick={handleAvatarPick}
                                onUsernameCheck={setUsernameCheck}
                            />
                        )}
                        {step === 2 && (
                            <Step2Details
                                data={data}
                                onChange={update}
                                onToggleOpenTo={(value) => setData((current) => ({ ...current, openTo: toggleIn(current.openTo, value) }))}
                                onSocialLinkChange={(key: OnboardingSocialLinkKey, value: string) =>
                                    setData((current) => ({ ...current, socialLinks: { ...current.socialLinks, [key]: value } }))
                                }
                                isDetectingLocation={isDetectingLocation}
                                locationError={locationError}
                                onDetectLocation={detectLocation}
                                showErrors={showErrors}
                            />
                        )}
                        {step === 3 && (
                            <Step3Skills
                                skills={data.skills}
                                interests={data.interests}
                                onSkillsChange={(skills) => update({ skills })}
                                onToggleInterest={(value) => setData((current) => ({ ...current, interests: toggleIn(current.interests, value) }))}
                            />
                        )}
                        {step === 4 && (
                            <Step4Privacy
                                visibility={data.visibility}
                                messagePrivacy={data.messagePrivacy}
                                onVisibilityChange={(visibility) => update({ visibility })}
                                onMessagePrivacyChange={(messagePrivacy) => update({ messagePrivacy })}
                                summaryItems={summaryItems}
                            />
                        )}
                    </fieldset>

                    {error ? (
                        <div className="onb-alert-error mt-6" role="alert">
                            {error}
                        </div>
                    ) : null}
                </div>

                <StepFooter
                    showBack={step > 1}
                    busy={busy}
                    blockedReason={reason}
                    nextLabel={nextLabel}
                    status={commitFailed ? 'Your entries are kept in this browser. Try again when you are ready.' : undefined}
                    onBack={goBack}
                    skipLabel={step === 2 && !returnToReview ? 'Skip for now' : undefined}
                    onSkip={step === 2 ? () => void advance(true) : undefined}
                    onBlocked={() => setShowErrors(true)}
                />
            </form>
        </OnboardingLayout>
    )
}
