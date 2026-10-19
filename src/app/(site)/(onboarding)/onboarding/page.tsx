'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { queryKeys } from '@/lib/query-keys'
import { getRolePreferences } from '@/lib/profile/role-preferences'

import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout'
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar'
import { MobileProgressBar } from '@/components/onboarding/MobileProgressBar'
import { StepHeader } from '@/components/onboarding/StepHeader'
import { StepFooter } from '@/components/onboarding/StepFooter'
import { StepTransition, prefersReducedMotion } from '@/components/onboarding/StepTransition'
import { BrandMark } from '@/components/brand/BrandMark'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const Step1Identity = dynamic(() => import('@/components/onboarding/steps/Step1Identity').then(mod => mod.Step1Identity))
const Step2Details = dynamic(() => import('@/components/onboarding/steps/Step2Details'))
const Step3Skills = dynamic(() => import('@/components/onboarding/steps/Step3Skills'))
const Step4Privacy = dynamic(() => import('@/components/onboarding/steps/Step4Privacy').then(mod => mod.Step4Privacy))
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'
import type { UsernameAvailabilityStatus } from '@/hooks/useUsernameAvailability'
import {
    clearOnboardingDraft,
    commitOnboardingStep,
    completeOnboarding,
    repairOnboardingClaims,
} from '@/app/actions/onboarding'
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from '@/app/actions/profile'
import { useAuth } from '@/hooks/use-auth'
import { useOnboardingBootstrap } from '@/components/onboarding/OnboardingBootstrapProvider'
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client'
import { validateUsername } from '@/lib/validations/username'
import {
    ONBOARDING_EXPERIENCE_LEVEL_VALUES,
    ONBOARDING_GENDER_VALUES,
    ONBOARDING_HOURS_PER_WEEK_VALUES,
    ONBOARDING_MESSAGE_PRIVACY_VALUES,
    ONBOARDING_SOCIAL_KEYS,
    ONBOARDING_TOTAL_STEPS,
    ONBOARDING_VISIBILITY_VALUES,
    type OnboardingExperienceLevel,
    type OnboardingGenderIdentity,
    type OnboardingHoursPerWeek,
    type OnboardingMessagePrivacy,
    type OnboardingSocialLinkKey,
    type OnboardingVisibility,
} from '@/lib/onboarding/contracts'
import {
    ONBOARDING_FEATURE_FLAGS,
    ONBOARDING_REQUIRED_FIELDS,
    ONBOARDING_STEP2_SECTIONS,
    type OnboardingStep2SectionId,
} from '@/lib/onboarding/config'
import { ONBOARDING_TELEMETRY_BATCH_LIMIT, type OnboardingEventInput } from '@/lib/onboarding/events'
import { compressAvatarOffMainThread } from '@/lib/services/avatar-worker-client'
import {
    ONBOARDING_LOCAL_DRAFT_TTL_MS,
    ONBOARDING_SCHEMA_VERSION,
    clampCompletedThrough,
    clampOnboardingStep,
    normalizeOnboardingSection,
    onboardingStorageKeys,
} from '@/lib/onboarding/state'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'
import {
    Loader2,
} from 'lucide-react'

// Interest suggestions
const INTEREST_SUGGESTIONS = [
    'Open Source', 'Startups', 'AI/ML', 'Web3', 'Gaming',
    'Education', 'Healthcare', 'Fintech', 'E-commerce', 'SaaS',
    'Climate Tech', 'Social Impact', 'Creative Tools', 'Developer Tools', 'DevOps'
]



type OnboardingSocialLinksState = Record<OnboardingSocialLinkKey, string>

type OnboardingDataUpdates = Partial<Omit<OnboardingData, 'socialLinks'>> & {
    socialLinks?: Partial<OnboardingSocialLinksState>
}

interface OnboardingData {
    username: string
    fullName: string
    avatarUrl: string
    headline: string
    bio: string
    location: string
    website: string
    skills: string[]
    interests: string[]
    openTo: string[]
    messagePrivacy: OnboardingMessagePrivacy
    socialLinks: OnboardingSocialLinksState
    experienceLevel: OnboardingExperienceLevel | ''
    hoursPerWeek: OnboardingHoursPerWeek | ''
    genderIdentity: OnboardingGenderIdentity | ''
    pronouns: string
    visibility: OnboardingVisibility
}

type InteractionKind = 'input' | 'toggle'

const TOTAL_STEPS = ONBOARDING_TOTAL_STEPS
const ONBOARDING_DRAFT_KEY_LEGACY = 'onboarding:draft:v1'
const ONBOARDING_DRAFT_KEY_LEGACY_V2 = 'onboarding:draft:v2'
const ONBOARDING_SUBMIT_KEY_LEGACY = 'onboarding:submit-key:v1'
const EMPTY_ONBOARDING_DATA: OnboardingData = {
    username: '',
    fullName: '',
    avatarUrl: '',
    headline: '',
    bio: '',
    location: '',
    website: '',
    skills: [],
    interests: [],
    openTo: [],
    messagePrivacy: 'connections',
    socialLinks: ONBOARDING_SOCIAL_KEYS.reduce((acc, key) => {
        acc[key] = ''
        return acc
    }, {} as OnboardingSocialLinksState),
    experienceLevel: '',
    hoursPerWeek: '',
    genderIdentity: '',
    pronouns: '',
    visibility: 'public',
}

type ScopedLocalDraft = {
    userId: string
    step: number
    completedThrough: number
    activeSection: OnboardingStep2SectionId
    baseVersion: number
    schemaVersion: number
    data: Partial<OnboardingData>
    expiresAt: number
}

function parseStoredOnboardingDraft(raw: string, expectedUserId: string): ScopedLocalDraft | null {
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') return null
        if (parsed.userId !== expectedUserId) return null
        if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null

        const step =
            typeof parsed.step === 'number' && Number.isFinite(parsed.step)
                ? Math.min(TOTAL_STEPS, Math.max(1, Math.floor(parsed.step)))
                : 1

        const sourceData =
            parsed.data && typeof parsed.data === 'object'
                ? (parsed.data as Record<string, unknown>)
                : {}
        const data: Partial<OnboardingData> = {}

        if (typeof sourceData.username === 'string') data.username = sourceData.username
        if (typeof sourceData.fullName === 'string') data.fullName = sourceData.fullName
        if (typeof sourceData.avatarUrl === 'string') data.avatarUrl = sourceData.avatarUrl
        if (typeof sourceData.headline === 'string') data.headline = sourceData.headline
        if (typeof sourceData.bio === 'string') data.bio = sourceData.bio
        if (typeof sourceData.location === 'string') data.location = sourceData.location
        if (typeof sourceData.website === 'string') data.website = sourceData.website
        if (Array.isArray(sourceData.skills)) {
            data.skills = sourceData.skills.filter((skill): skill is string => typeof skill === 'string')
        }
        if (Array.isArray(sourceData.interests)) {
            data.interests = sourceData.interests.filter((interest): interest is string => typeof interest === 'string')
        }
        if (Array.isArray(sourceData.openTo)) {
            data.openTo = getRolePreferences(sourceData.openTo)
        }
        if (ONBOARDING_MESSAGE_PRIVACY_VALUES.includes(sourceData.messagePrivacy as OnboardingMessagePrivacy)) {
            data.messagePrivacy = sourceData.messagePrivacy as OnboardingMessagePrivacy
        }
        if (ONBOARDING_EXPERIENCE_LEVEL_VALUES.includes(sourceData.experienceLevel as OnboardingExperienceLevel)) {
            data.experienceLevel = sourceData.experienceLevel as OnboardingExperienceLevel
        }
        if (ONBOARDING_HOURS_PER_WEEK_VALUES.includes(sourceData.hoursPerWeek as OnboardingHoursPerWeek)) {
            data.hoursPerWeek = sourceData.hoursPerWeek as OnboardingHoursPerWeek
        }
        if (ONBOARDING_GENDER_VALUES.includes(sourceData.genderIdentity as OnboardingGenderIdentity)) {
            data.genderIdentity = sourceData.genderIdentity as OnboardingGenderIdentity
        }
        if (typeof sourceData.pronouns === 'string') data.pronouns = sourceData.pronouns
        if (sourceData.socialLinks && typeof sourceData.socialLinks === 'object') {
            const links = sourceData.socialLinks as Record<string, unknown>
            data.socialLinks = ONBOARDING_SOCIAL_KEYS.reduce((acc, key) => {
                acc[key] = typeof links[key] === 'string' ? (links[key] as string) : ''
                return acc
            }, {} as OnboardingSocialLinksState)
        }
        if (ONBOARDING_VISIBILITY_VALUES.includes(sourceData.visibility as OnboardingVisibility)) {
            data.visibility = sourceData.visibility as OnboardingVisibility
        }

        return {
            userId: expectedUserId,
            step,
            completedThrough: clampCompletedThrough(parsed.completedThrough),
            activeSection: normalizeOnboardingSection(parsed.activeSection),
            baseVersion: typeof parsed.baseVersion === 'number' ? Math.max(0, Math.floor(parsed.baseVersion)) : 0,
            schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : ONBOARDING_SCHEMA_VERSION,
            data,
            expiresAt: parsed.expiresAt,
        }
    } catch {
        return null
    }
}

function readOnboardingDraft(userId: string, draftKey: string): ScopedLocalDraft | null {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(draftKey)
    if (!raw) return null
    const parsed = parseStoredOnboardingDraft(raw, userId)
    if (!parsed) window.localStorage.removeItem(draftKey)
    return parsed
}

function getOnboardingReturnPath() {
    if (typeof window === 'undefined') return '/discover'
    const requested = new URLSearchParams(window.location.search).get('next')
    const normalized = normalizeAuthNextPath(requested)
    return normalized === '/onboarding' || normalized.startsWith('/onboarding?') ? '/discover' : normalized
}

function mergeOnboardingData(current: OnboardingData, updates: OnboardingDataUpdates): OnboardingData {
    const { socialLinks: socialLinkUpdates, ...restUpdates } = updates
    const definedUpdates = Object.fromEntries(
        Object.entries(restUpdates).filter(([, value]) => value !== undefined)
    ) as Partial<Omit<OnboardingData, 'socialLinks'>>

    const nextSocialLinks = { ...current.socialLinks }
    if (socialLinkUpdates) {
        for (const key of ONBOARDING_SOCIAL_KEYS) {
            const value = socialLinkUpdates[key]
            if (value !== undefined) {
                nextSocialLinks[key] = value
            }
        }
    }

    return {
        ...current,
        ...definedUpdates,
        socialLinks: nextSocialLinks,
    }
}

function normalizeDraftForSave(data: OnboardingData) {
    const normalizeList = (values: string[]) =>
        values.map((value) => value.trim()).filter(Boolean)

    const normalizeSocial = (links: OnboardingData['socialLinks']) =>
        ONBOARDING_SOCIAL_KEYS.reduce((acc, key) => {
            const value = (links[key] || '').trim()
            acc[key] = value
            return acc
        }, {} as OnboardingData['socialLinks'])

    return {
        ...data,
        username: data.username.trim(),
        fullName: data.fullName.trim(),
        headline: data.headline.trim(),
        bio: data.bio.trim(),
        location: data.location.trim(),
        website: data.website.trim(),
        pronouns: data.pronouns.trim() || undefined,
        skills: normalizeList(data.skills),
        interests: normalizeList(data.interests),
        openTo: normalizeList(data.openTo),
        socialLinks: normalizeSocial(data.socialLinks),
        experienceLevel: data.experienceLevel || undefined,
        hoursPerWeek: data.hoursPerWeek || undefined,
        genderIdentity: data.genderIdentity || undefined,
    }
}

function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `onboarding:${crypto.randomUUID()}`
    }
    return `onboarding:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

export default function OnboardingPage() {
    const queryClient = useQueryClient()
    const bootstrap = useOnboardingBootstrap()
    const { user, profile, refreshProfile } = useAuth()
    const storageKeys = useMemo(() => onboardingStorageKeys(bootstrap.userId), [bootstrap.userId])
    const initialData = useMemo(() => {
        const hydrated = mergeOnboardingData(
            EMPTY_ONBOARDING_DATA,
            bootstrap.draft.data as OnboardingDataUpdates,
        )
        const metadata = user?.user_metadata || {}
        return mergeOnboardingData(hydrated, {
            fullName: hydrated.fullName || profile?.fullName || metadata.full_name || metadata.name || '',
            avatarUrl: hydrated.avatarUrl || profile?.avatarUrl || metadata.avatar_url || metadata.picture || '',
        })
    }, [bootstrap.draft.data, profile?.avatarUrl, profile?.fullName, user?.user_metadata])

    const [step, setStep] = useState(() => clampOnboardingStep(bootstrap.draft.step))
    const [completedThrough, setCompletedThrough] = useState(() => clampCompletedThrough(bootstrap.draft.completedThrough))
    const [justCompletedStep, setJustCompletedStep] = useState<number | null>(null)
    const [transitionDirection, setTransitionDirection] = useState<'forward' | 'backward' | 'section'>('forward')
    const [usernameStatus, setUsernameStatus] = useState<UsernameAvailabilityStatus>('idle')
    const [step2Section, setStep2Section] = useState<OnboardingStep2SectionId>(() => normalizeOnboardingSection(bootstrap.draft.activeSection))
    const [isLoading, setIsLoading] = useState(false)
    const [isCommittingStep, setIsCommittingStep] = useState(false)
    const [isInitializing, setIsInitializing] = useState(false)
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
    const [isDetectingLocation, setIsDetectingLocation] = useState(false)
    const [isWelcomeTransitioning, setIsWelcomeTransitioning] = useState(false)
    const [avatarStatus, setAvatarStatus] = useState<string | null>(null)
    const [locationError, setLocationError] = useState<string | null>(null)
    const bootstrapHydratedRef = useRef(false)
    const draftVersionRef = useRef<number>(bootstrap.draft.version)
    const pendingTelemetryRef = useRef<OnboardingEventInput[]>([])
    const avatarPreviewUrlRef = useRef<string | null>(null)
    const lastSyncedDraftRef = useRef<OnboardingData>(initialData)
    const renderStartedAtRef = useRef<number>(Date.now())
    const measuredInputStepsRef = useRef<Set<number>>(new Set())
    const lastRenderMetricAtRef = useRef<number>(0)
    const submitIdempotencyKeyRef = useRef<string>('')
    const submitInFlightRef = useRef(false)
    const onboardingStartedAtRef = useRef<number>(Date.now())
    const stepEnteredAtRef = useRef<number>(Date.now())
    const lastStepViewRef = useRef<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<OnboardingData>(initialData)

    const telemetrySnapshot = useMemo(() => ({
        skillsCount: data.skills.length,
        interestsCount: data.interests.length,
        openToCount: data.openTo.length,
        socialLinksCount: Object.values(data.socialLinks).filter(Boolean).length,
        hasIdentityDetails: Boolean(data.genderIdentity || data.pronouns),
        hasProfessionalDetails: Boolean(data.headline || data.bio || data.location || data.website),
        messagePrivacy: data.messagePrivacy,
        visibility: data.visibility,
    }), [data])
    const telemetrySnapshotRef = useRef(telemetrySnapshot)
    useEffect(() => {
        telemetrySnapshotRef.current = telemetrySnapshot
    }, [telemetrySnapshot])

    const trackEvent = useCallback((payload: OnboardingEventInput) => {
        pendingTelemetryRef.current.push(payload)
        if (pendingTelemetryRef.current.length > ONBOARDING_TELEMETRY_BATCH_LIMIT) {
            pendingTelemetryRef.current.shift()
        }
    }, [])

    // Reconcile the server bootstrap with the same-user crash buffer.
    useEffect(() => {
        if (bootstrapHydratedRef.current) return
        bootstrapHydratedRef.current = true
        async function hydrateDraft() {
            const localDraft = readOnboardingDraft(bootstrap.userId, storageKeys.draft)
            try {
                if (typeof window !== 'undefined' && !submitIdempotencyKeyRef.current) {
                    const storedSubmitKey = window.localStorage.getItem(storageKeys.submit) || ''
                    submitIdempotencyKeyRef.current = storedSubmitKey || generateIdempotencyKey()
                    window.localStorage.setItem(storageKeys.submit, submitIdempotencyKeyRef.current)
                    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY)
                    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY_V2)
                    window.localStorage.removeItem(ONBOARDING_SUBMIT_KEY_LEGACY)
                }

                if (localDraft && localDraft.baseVersion >= bootstrap.draft.version) {
                    setStep(localDraft.step)
                    setCompletedThrough(localDraft.completedThrough)
                    setStep2Section(localDraft.activeSection)
                    setData(prev => mergeOnboardingData(prev, localDraft.data))
                }

                if (user) {
                    const { ensureUserProfile } = await import('@/app/actions/database')
                    await ensureUserProfile()
                }
                const resumedStep = localDraft && localDraft.baseVersion >= bootstrap.draft.version
                    ? localDraft.step
                    : bootstrap.draft.step
                trackEvent({
                    eventType: 'draft_loaded',
                    step: resumedStep,
                    metadata: {
                        localDraftSource: localDraft ? 'scoped_v3' : 'none',
                        hadRemoteDraft: bootstrap.draft.version > 0,
                        serverVersion: bootstrap.draft.version,
                    },
                })
            } catch (error) {
                console.warn('Onboarding bootstrap degraded; continuing with server state:', error)
            } finally {
                setIsInitializing(false)
            }
        }

        void hydrateDraft()
    }, [bootstrap.draft.step, bootstrap.draft.version, bootstrap.userId, storageKeys.draft, storageKeys.submit, trackEvent, user])

    useEffect(() => {
        if (isInitializing || typeof window === 'undefined') return
        try {
            const localData = data.avatarUrl.startsWith('blob:')
                ? { ...data, avatarUrl: lastSyncedDraftRef.current.avatarUrl }
                : data
            window.localStorage.setItem(
                storageKeys.draft,
                JSON.stringify({
                    userId: bootstrap.userId,
                    step,
                    completedThrough,
                    activeSection: step2Section,
                    baseVersion: draftVersionRef.current,
                    schemaVersion: ONBOARDING_SCHEMA_VERSION,
                    data: localData,
                    expiresAt: Date.now() + ONBOARDING_LOCAL_DRAFT_TTL_MS,
                })
            )
            window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY)
            window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY_V2)
        } catch (storageError) {
            console.warn('Unable to persist onboarding draft:', storageError)
        }
    }, [bootstrap.userId, completedThrough, data, isInitializing, step, step2Section, storageKeys.draft])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const preload = () => {
            void import('@/lib/services/location-service')
            void import('@/app/actions/onboarding')
        }

        const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void }
        if (typeof w.requestIdleCallback === 'function') {
            const id = w.requestIdleCallback(preload)
            return () => {
                if (typeof w.cancelIdleCallback === 'function') {
                    w.cancelIdleCallback(id)
                }
            }
        }

        const timeout = window.setTimeout(preload, 250)
        return () => window.clearTimeout(timeout)
    }, [])

    useEffect(() => {
        if (isInitializing) return
        if (lastStepViewRef.current === step) return

        stepEnteredAtRef.current = Date.now()
        lastStepViewRef.current = step
        const stableTelemetrySnapshot = telemetrySnapshotRef.current
        trackEvent({
            eventType: 'step_view',
            step,
            metadata: {
                ...stableTelemetrySnapshot,
                step2Section,
            },
        })
    }, [step, isInitializing, step2Section, trackEvent])

    useEffect(() => {
        if (isInitializing) return
        const raf = window.requestAnimationFrame(() => {
            const now = performance.now()
            if (now - lastRenderMetricAtRef.current < 500) return
            lastRenderMetricAtRef.current = now
            trackEvent({
                eventType: 'step_render_time',
                step,
                metadata: {
                    durationMs: Math.round(now - renderStartedAtRef.current),
                    step2Section,
                },
            })
        })
        return () => window.cancelAnimationFrame(raf)
    }, [step, step2Section, isInitializing, trackEvent])

    const updateData = useCallback((updates: Partial<OnboardingData>, kind: InteractionKind = 'input') => {
        if (kind === 'input' && !measuredInputStepsRef.current.has(step)) {
            measuredInputStepsRef.current.add(step)
            const startedAt = performance.now()
            window.requestAnimationFrame(() => {
                trackEvent({
                    eventType: 'input_latency',
                    step,
                    metadata: {
                        durationMs: Math.round(performance.now() - startedAt),
                    },
                })
            })
        }
        setData(prev => mergeOnboardingData(prev, updates))
    }, [step, trackEvent])

    // Handle avatar file selection - show preview immediately
    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const previousAvatarUrl = data.avatarUrl

        if (!file.type.startsWith('image/')) {
            setError('Please select an image file')
            return
        }

        if (file.size > 2 * 1024 * 1024) {
            setError('Image must be 2MB or smaller')
            return
        }

        setIsUploadingAvatar(true)
        setError(null)
        setAvatarStatus(null)

        try {
            // Show immediate preview using object URL
            if (avatarPreviewUrlRef.current) URL.revokeObjectURL(avatarPreviewUrlRef.current)
            const previewUrl = URL.createObjectURL(file)
            avatarPreviewUrlRef.current = previewUrl
            updateData({ avatarUrl: previewUrl })

            // Try to upload compressed version to storage (background, non-blocking)
            try {
                const compressedBlob = await compressAvatarOffMainThread(file)
                const uploadSession = await createProfileImageUploadUrlAction({
                    mimeType: 'image/jpeg',
                    sizeBytes: compressedBlob.size,
                    kind: 'avatar',
                })
                if (!uploadSession.success) {
                    throw new Error(uploadSession.error || 'Failed to prepare avatar upload')
                }

                await uploadToSupabaseSignedUrl(uploadSession, compressedBlob, { cacheProfile: 'public' })

                const finalized = await finalizeProfileImageUploadAction({
                    uploadIntentId: uploadSession.uploadIntentId,
                })
                if (!finalized.success) {
                    throw new Error(finalized.error || 'Failed to finalize avatar upload')
                }

                updateData({ avatarUrl: finalized.publicUrl })
                setAvatarStatus('Profile photo uploaded. You can replace it before finishing.')
                URL.revokeObjectURL(previewUrl)
                avatarPreviewUrlRef.current = null
            } catch (uploadError) {
                URL.revokeObjectURL(previewUrl)
                avatarPreviewUrlRef.current = null
                updateData({ avatarUrl: previousAvatarUrl })
                throw uploadError
            }
        } catch (error) {
            console.error('Avatar error:', error)
            setError('We could not upload that photo. Your previous photo is unchanged.')
            setAvatarStatus(null)
        } finally {
            setIsUploadingAvatar(false)
        }
    }

    useEffect(() => {
        return () => {
            if (avatarPreviewUrlRef.current) URL.revokeObjectURL(avatarPreviewUrlRef.current)
        }
    }, [])

    const nextStep = async () => {
        if (step === 2 && ONBOARDING_FEATURE_FLAGS.enableStep2Sections) {
            const currentIndex = ONBOARDING_STEP2_SECTIONS.findIndex((item) => item.id === step2Section)
            if (currentIndex >= 0 && currentIndex < ONBOARDING_STEP2_SECTIONS.length - 1) {
                renderStartedAtRef.current = performance.now()
                setTransitionDirection('section')
                setStep2Section(ONBOARDING_STEP2_SECTIONS[currentIndex + 1]!.id)
                return
            }
        }
        if (step >= TOTAL_STEPS || isCommittingStep) return

        setIsCommittingStep(true)
        setError(null)
        const committingStep = step
        const durationMs = Date.now() - stepEnteredAtRef.current
        try {
            const telemetry = pendingTelemetryRef.current.slice()
            const result = await commitOnboardingStep({
                step: committingStep,
                draft: normalizeDraftForSave(data),
                activeSection: step2Section,
                expectedVersion: draftVersionRef.current,
                telemetry,
            })

            if (!result.success) {
                if (result.errorDetails?.code === 'DRAFT_CONFLICT') {
                    draftVersionRef.current = result.version ?? draftVersionRef.current
                    if (result.draft) {
                        setData(prev => mergeOnboardingData(prev, result.draft!))
                        lastSyncedDraftRef.current = mergeOnboardingData(lastSyncedDraftRef.current, result.draft)
                    }
                    if (typeof result.step === 'number') {
                        setStep(result.step)
                    }
                    if (typeof result.committedThrough === 'number') {
                        setCompletedThrough(result.committedThrough)
                    }
                    if (result.activeSection) {
                        setStep2Section(result.activeSection)
                    }
                    trackEvent({
                        eventType: 'draft_conflict',
                        step: committingStep,
                        metadata: { serverVersion: result.version ?? -1 },
                    })
                }
                trackEvent({
                    eventType: 'step_commit_error',
                    step: committingStep,
                    metadata: { reason: result.errorDetails?.code || 'unknown' },
                })
                setError(result.errorDetails?.message || result.error || 'Unable to save this step.')
                return
            }

            draftVersionRef.current = result.version ?? draftVersionRef.current
            pendingTelemetryRef.current.splice(0, telemetry.length)
            lastSyncedDraftRef.current = data
            setCompletedThrough(result.committedThrough ?? committingStep)
            setJustCompletedStep(committingStep)
            trackEvent({
                eventType: 'step_commit_success',
                step: committingStep,
                metadata: { version: result.version ?? draftVersionRef.current },
            })
            trackEvent({
                eventType: 'step_continue',
                step: committingStep,
                metadata: {
                    ...telemetrySnapshot,
                    durationMs,
                    step2Section,
                },
            })
            trackEvent({
                eventType: 'time_to_continue',
                step: committingStep,
                metadata: { durationMs },
            })

            if (!prefersReducedMotion()) {
                await new Promise((resolve) => window.setTimeout(resolve, 160))
            }
            renderStartedAtRef.current = performance.now()
            if (committingStep === 1) {
                setStep2Section(ONBOARDING_STEP2_SECTIONS[0].id)
            }
            setTransitionDirection('forward')
            setStep(result.step ?? committingStep + 1)
        } catch (commitError) {
            console.error('Unable to commit onboarding step:', commitError)
            setError('Unable to save this step right now. Your entries remain available in this browser.')
        } finally {
            setJustCompletedStep(null)
            setIsCommittingStep(false)
        }
    }

    const prevStep = () => {
        if (step === 2 && ONBOARDING_FEATURE_FLAGS.enableStep2Sections) {
            const currentIndex = ONBOARDING_STEP2_SECTIONS.findIndex((item) => item.id === step2Section)
            if (currentIndex > 0) {
                renderStartedAtRef.current = performance.now()
                setTransitionDirection('section')
                setStep2Section(ONBOARDING_STEP2_SECTIONS[currentIndex - 1]!.id)
                return
            }
        }
        if (step > 1) {
            const durationMs = Date.now() - stepEnteredAtRef.current
            trackEvent({
                eventType: 'step_back',
                step,
                metadata: {
                    ...telemetrySnapshot,
                    durationMs,
                    step2Section,
                },
            })
            renderStartedAtRef.current = performance.now()
            if (step === 3) {
                setStep2Section(ONBOARDING_STEP2_SECTIONS[ONBOARDING_STEP2_SECTIONS.length - 1]!.id)
            }
            setTransitionDirection('backward')
            setStep(step - 1)
        }
    }

    const editOnboardingStep = (targetStep: number) => {
        if (targetStep < 1 || targetStep > TOTAL_STEPS || isCommittingStep || isLoading) return
        renderStartedAtRef.current = performance.now()
        setTransitionDirection(targetStep < step ? 'backward' : 'forward')
        if (targetStep === 2) {
            setStep2Section('profile')
        }
        setStep(targetStep)
    }

    const toggleSkill = useCallback((skill: string) => {
        setData(prev => ({
            ...prev,
            skills: prev.skills.includes(skill)
                ? prev.skills.filter(s => s !== skill)
                : [...prev.skills, skill]
        }))
    }, [])

    const toggleInterest = useCallback((interest: string) => {
        setData(prev => ({
            ...prev,
            interests: prev.interests.includes(interest)
                ? prev.interests.filter(i => i !== interest)
                : [...prev.interests, interest]
        }))
    }, [])

    const toggleOpenTo = useCallback((option: string) => {
        setData(prev => ({
            ...prev,
            openTo: prev.openTo.includes(option)
                ? prev.openTo.filter((item) => item !== option)
                : [...prev.openTo, option],
        }))
    }, [])

    const updateSocialLink = useCallback((key: OnboardingSocialLinkKey, value: string) => {
        setData(prev => ({
            ...prev,
            socialLinks: {
                ...prev.socialLinks,
                [key]: value,
            },
        }))
    }, [])

    const handleSubmit = async () => {
        if (submitInFlightRef.current) return
        submitInFlightRef.current = true
        setError(null)
        const idempotencyKey = submitIdempotencyKeyRef.current
        if (!idempotencyKey) {
            setError('Unable to submit yet. Please wait a moment and retry.')
            submitInFlightRef.current = false
            return
        }
        setIsLoading(true)
        const timeOnCurrentStepMs = Date.now() - stepEnteredAtRef.current
        const totalOnboardingMs = Date.now() - onboardingStartedAtRef.current
        trackEvent({
            eventType: 'submit_start',
            step: TOTAL_STEPS,
            metadata: {
                ...telemetrySnapshot,
                timeOnCurrentStepMs,
                totalOnboardingMs,
            },
        })
        trackEvent({
            eventType: 'time_to_submit',
            step: TOTAL_STEPS,
            metadata: {
                timeOnCurrentStepMs,
                totalOnboardingMs,
            },
        })

        try {
            const telemetry = pendingTelemetryRef.current.slice()
            const result = await completeOnboarding({
                username: data.username,
                fullName: data.fullName,
                avatarUrl: data.avatarUrl,
                headline: data.headline,
                bio: data.bio,
                location: data.location,
                website: data.website,
                skills: data.skills,
                interests: data.interests,
                openTo: data.openTo,
                messagePrivacy: data.messagePrivacy,
                socialLinks: data.socialLinks,
                experienceLevel: data.experienceLevel || undefined,
                hoursPerWeek: data.hoursPerWeek || undefined,
                genderIdentity: data.genderIdentity || undefined,
                pronouns: data.pronouns,
                visibility: data.visibility,
                idempotencyKey,
                telemetry,
            })

            if (!result.success) {
                setError(result.errorDetails?.message || result.error || 'Failed to complete setup')
                trackEvent({
                    eventType: 'submit_error',
                    step: TOTAL_STEPS,
                    metadata: {
                        reason: result.errorDetails?.code || result.error || 'unknown',
                        ...telemetrySnapshot,
                    },
                })
                return
            }

            pendingTelemetryRef.current.splice(0, telemetry.length)

            if (result.needsMetadataSync) {
                try {
                    await repairOnboardingClaims()
                } catch (repairError) {
                    console.error('Unable to repair onboarding claims:', repairError)
                }
            }

            const supabase = createClient()
            await Promise.allSettled([
                supabase.auth.refreshSession(),
                refreshProfile(),
                clearOnboardingDraft(),
            ])
            if (data.username) {
                queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(data.username) })
            }
            if (typeof window !== 'undefined') {
                const checklistItems = [
                    !data.headline ? 'Add a headline' : null,
                    !data.bio ? 'Add a short bio' : null,
                    data.skills.length < 3 ? 'Add at least 3 skills' : null,
                    data.openTo.length === 0 ? 'Set role preferences' : null,
                    Object.values(data.socialLinks).filter(Boolean).length === 0 ? 'Add at least 1 social link' : null,
                ].filter((item): item is string => Boolean(item))

                window.localStorage.setItem(
                    'onboarding:profile-strength:v1',
                    JSON.stringify({
                        // Discover shows it only to this account (a shared browser has more than one).
                        userId: bootstrap.userId,
                        createdAt: Date.now(),
                        items: checklistItems,
                    })
                )
                window.localStorage.removeItem(storageKeys.draft)
                window.localStorage.removeItem(storageKeys.submit)
            }
            setCompletedThrough(TOTAL_STEPS)
            setJustCompletedStep(TOTAL_STEPS)
            trackEvent({
                eventType: 'submit_success',
                step: TOTAL_STEPS,
                metadata: {
                    ...telemetrySnapshot,
                    needsMetadataSync: result.needsMetadataSync === true,
                    totalOnboardingMs: Date.now() - onboardingStartedAtRef.current,
                },
            })
            setIsWelcomeTransitioning(true)
            if (!prefersReducedMotion()) {
                await new Promise((resolve) => window.setTimeout(resolve, 1400))
            }
            window.location.replace(getOnboardingReturnPath())

        } catch {
            setError('An unexpected error occurred')
            trackEvent({
                eventType: 'submit_error',
                step: TOTAL_STEPS,
                metadata: {
                    reason: 'unexpected',
                    ...telemetrySnapshot,
                },
            })
        } finally {
            setJustCompletedStep(null)
            submitInFlightRef.current = false
            setIsLoading(false)
        }
    }

    const canProceed = () => {
        const required = ONBOARDING_REQUIRED_FIELDS[step as 1 | 2 | 3 | 4] || []
        for (const field of required) {
            if (field === 'username') {
                if (!validateUsername(data.username).valid) return false
                if (usernameStatus !== 'valid') return false
            }
            if (field === 'fullName' && data.fullName.trim().length < 2) return false
            if (field === 'skills' && data.skills.length < 1) return false
        }
        return true
    }

    const proceedReason = () => {
        if (step === 1) {
            if (data.fullName.trim().length < 2) return 'Enter your full name to continue.'
            if (!validateUsername(data.username).valid) return 'Enter a username using 3–20 letters, numbers, underscores, or hyphens.'
            if (usernameStatus === 'checking') return 'Checking whether this username is available.'
            if (usernameStatus !== 'valid') return 'Choose an available username to continue.'
        }
        if (step === 3 && data.skills.length < 1) return 'Add at least one skill to continue.'
        return undefined
    }

    const selectedSkills = useMemo(() => new Set(data.skills), [data.skills])
    const selectedInterests = useMemo(() => new Set(data.interests), [data.interests])
    const filledSocialLinks = useMemo(
        () => Object.entries(data.socialLinks).filter(([, value]) => Boolean(value)),
        [data.socialLinks]
    )

    const completedSteps = useMemo(() => {
        const set = new Set<number>()
        for (let i = 1; i <= completedThrough; i++) {
            set.add(i)
        }
        return set
    }, [completedThrough])

    const sidebarStepLabels = useMemo(() =>
        STEP_UI_CONFIG.map((cfg) => ({ title: cfg.sidebarLabel, subtitle: cfg.subtitle })),
        []
    )

    const mobileStepLabels = useMemo(() =>
        STEP_UI_CONFIG.map((cfg) => cfg.sidebarLabel),
        []
    )

    const currentStepConfig = STEP_UI_CONFIG[step - 1]

    if (isInitializing) {
        return (
            <OnboardingLayout>
                <div className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
                    <span className="sr-only">Loading your saved onboarding draft.</span>
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                </div>
            </OnboardingLayout>
        )
    }

    if (isWelcomeTransitioning) {
        return (
            <OnboardingLayout
                sidebar={
                    <OnboardingSidebar
                        currentStep={TOTAL_STEPS}
                        totalSteps={TOTAL_STEPS}
                        stepLabels={sidebarStepLabels}
                        completedSteps={new Set([1, 2, 3, 4])}
                        justCompletedStep={TOTAL_STEPS}
                    />
                }
                mobileProgress={
                    <MobileProgressBar
                        currentStep={TOTAL_STEPS}
                        totalSteps={TOTAL_STEPS}
                        stepLabels={mobileStepLabels}
                        completedThrough={TOTAL_STEPS}
                        justCompletedStep={TOTAL_STEPS}
                    />
                }
            >
                <div className="flex flex-col items-center text-center animate-in fade-in-50 duration-500 py-6 sm:py-10">
                    {/* Brand header */}
                    <div className="mb-6 flex items-center justify-center">
                        <BrandMark size={17} trademark />
                    </div>

                    {/* Member Profile Squircle Lockup */}
                    <div className="mb-6 flex flex-col items-center">
                        <div className="size-16 rounded-md overflow-hidden bg-muted flex items-center justify-center shadow-sm border border-border/60">
                            {data.avatarUrl ? (
                                <img
                                    src={data.avatarUrl}
                                    alt={data.fullName}
                                    className="size-full object-cover rounded-md"
                                />
                            ) : (
                                <div className="size-full flex items-center justify-center bg-amber-100 text-amber-900 font-bold text-lg rounded-md">
                                    {(data.fullName || data.username || 'U').slice(0, 2).toUpperCase()}
                                </div>
                            )}
                        </div>
                        <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            Member Profile
                        </div>
                        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                            Welcome to NetworkBase, {data.fullName}!
                        </h1>
                        <p className="mt-1 text-sm font-medium text-muted-foreground">
                            @{data.username}
                        </p>
                        {data.headline ? (
                            <p className="mt-1 max-w-md text-xs text-muted-foreground/80">
                                {data.headline}
                            </p>
                        ) : null}
                    </div>

                    {/* Welcome Text — Aligned verbatim with email */}
                    <div className="max-w-md rounded-lg border border-border/60 bg-card p-4 sm:p-5 text-left mb-6 shadow-sm">
                        <p className="text-sm leading-relaxed text-foreground/90">
                            Your profile is live. Connect with developers, collaborate on projects, and manage tasks seamlessly across your workspace.
                        </p>
                        {data.skills.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-border/40">
                                {data.skills.slice(0, 5).map((skill) => (
                                    <span
                                        key={skill}
                                        className="rounded-[4px] bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80"
                                    >
                                        {skill}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    {/* Transition state indicator + Direct jump affordance */}
                    <div className="flex flex-col items-center gap-3">
                        <button
                            type="button"
                            onClick={() => window.location.replace(getOnboardingReturnPath())}
                            className="inline-flex items-center justify-center rounded-md bg-[#C24720] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#b03f1b] transition-colors"
                        >
                            Explore Projects &rarr;
                        </button>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin text-[#C24720]" />
                            <span>Transitioning to Discovery feed...</span>
                        </div>
                        <p className="mt-4 text-xs text-muted-foreground/80">
                            A welcome briefing has been delivered to your inbox from <code className="font-mono text-foreground">welcome@networkbase.in</code>
                        </p>
                        <p className="mt-1.5 text-[11px] text-muted-foreground/60">
                            © {new Date().getFullYear()} NetworkBase™ · All rights reserved.
                        </p>
                    </div>
                </div>
            </OnboardingLayout>
        )
    }

    return (
        <OnboardingLayout
            sidebar={
                <OnboardingSidebar
                    currentStep={step}
                    totalSteps={TOTAL_STEPS}
                    stepLabels={sidebarStepLabels}
                    completedSteps={completedSteps}
                    justCompletedStep={justCompletedStep}
                />
            }
            mobileProgress={
                <MobileProgressBar
                    currentStep={step}
                    totalSteps={TOTAL_STEPS}
                    stepLabels={mobileStepLabels}
                    completedThrough={completedThrough}
                    justCompletedStep={justCompletedStep}
                />
            }
        >
            <StepTransition
                step={step}
                transitionKey={`${step}:${step === 2 ? step2Section : 'main'}`}
                direction={transitionDirection}
            >
                {/* Render StepHeader for steps 1 and 2 (steps 3 and 4 include their own) */}
                {(step === 1 || step === 2) && currentStepConfig && (
                    <StepHeader
                        title={currentStepConfig.title}
                        subtitle={currentStepConfig.subtitle}
                        step={step}
                        totalSteps={TOTAL_STEPS}
                    />
                )}

                {/* Step 1: Identity */}
                {step === 1 && (
                    <Suspense fallback={<div role="status" aria-label="Loading identity step" className="nb-skeleton h-96 w-full rounded-[var(--onb-radius-card)]" />}>
                        <Step1Identity
                            fullName={data.fullName}
                            username={data.username}
                            avatarUrl={data.avatarUrl}
                            isUploadingAvatar={isUploadingAvatar}
                            onFullNameChange={(value) => updateData({ fullName: value })}
                            onUsernameChange={(username) => updateData({ username })}
                            onAvatarChange={handleAvatarChange}
                            onUsernameStatusChange={setUsernameStatus}
                            avatarStatus={avatarStatus}
                        />
                    </Suspense>
                )}


                {/* Step 2: Profile Details with SectionNav */}
                {step === 2 && (
                    <Suspense fallback={<div role="status" aria-label="Loading details step" className="nb-skeleton h-96 w-full rounded-[var(--onb-radius-card)]" />}>
                        <Step2Details
                            step2Section={step2Section}
                            onSectionChange={(sectionId) => {
                                const nextSection = ONBOARDING_STEP2_SECTIONS.find((item) => item.id === sectionId)
                                if (!nextSection) return
                                renderStartedAtRef.current = performance.now()
                                setTransitionDirection('section')
                                setStep2Section(nextSection.id)
                            }}
                            genderIdentity={data.genderIdentity}
                            pronouns={data.pronouns}
                            onGenderChange={(value) => updateData({ genderIdentity: value }, 'toggle')}
                            onPronounsChange={(value) => updateData({ pronouns: value }, 'input')}
                            experienceLevel={data.experienceLevel}
                            hoursPerWeek={data.hoursPerWeek}
                            openTo={data.openTo}
                            onExperienceLevelChange={(value) => updateData({ experienceLevel: value }, 'toggle')}
                            onHoursPerWeekChange={(value) => updateData({ hoursPerWeek: value }, 'toggle')}
                            onToggleOpenTo={toggleOpenTo}
                            headline={data.headline}
                            bio={data.bio}
                            location={data.location}
                            website={data.website}
                            onHeadlineChange={(value) => updateData({ headline: value }, 'input')}
                            onBioChange={(value) => updateData({ bio: value }, 'input')}
                            onLocationChange={(value) => {
                                setLocationError(null)
                                updateData({ location: value }, 'input')
                            }}
                            onWebsiteChange={(value) => updateData({ website: value }, 'input')}
                            isDetectingLocation={isDetectingLocation}
                            locationError={locationError}
                            onDetectLocation={async () => {
                                setIsDetectingLocation(true)
                                setError(null)
                                setLocationError(null)
                                try {
                                    const { detectLocation } = await import('@/lib/services/location-service')
                                    const { location, error: locError } = await detectLocation()
                                    if (location) {
                                        updateData({ location: location.formatted }, 'input')
                                    } else if (locError) {
                                        setLocationError(locError)
                                    }
                                } catch {
                                    setLocationError('We could not determine your location. You can enter it manually.')
                                } finally {
                                    setIsDetectingLocation(false)
                                }
                            }}
                            socialLinks={data.socialLinks}
                            onSocialLinkChange={updateSocialLink}
                        />
                    </Suspense>
                )}

                {/* Step 3: Skills & Interests */}
                {step === 3 && (
                    <Suspense fallback={<div role="status" aria-label="Loading skills step" className="nb-skeleton h-96 w-full rounded-[var(--onb-radius-card)]" />}>
                        <Step3Skills
                            interestOptions={INTEREST_SUGGESTIONS.map((i) => ({ value: i, label: i }))}
                            selectedSkills={selectedSkills}
                            selectedInterests={selectedInterests}
                            onToggleSkill={toggleSkill}
                            onToggleInterest={toggleInterest}
                        />
                    </Suspense>
                )}

                {/* Step 4: Privacy & Review */}
                {step === 4 && (
                    <Suspense fallback={<div role="status" aria-label="Loading privacy step" className="nb-skeleton h-96 w-full rounded-[var(--onb-radius-card)]" />}>
                        <Step4Privacy
                            visibility={data.visibility}
                            messagePrivacy={data.messagePrivacy}
                            onVisibilityChange={(value) => updateData({ visibility: value }, 'toggle')}
                            onMessagePrivacyChange={(value) => updateData({ messagePrivacy: value }, 'toggle')}
                            summaryItems={[
                                { label: '@' + data.username, value: data.fullName, editLabel: 'Edit identity', onEdit: () => editOnboardingStep(1) },
                                { label: 'Visibility', value: data.visibility === 'public' ? 'Public' : data.visibility === 'connections' ? 'Connections only' : 'Private', editLabel: 'Edit privacy', onEdit: () => editOnboardingStep(4) },
                                { label: 'Messages', value: data.messagePrivacy === 'connections' ? 'Connections only' : 'Everyone', editLabel: 'Edit privacy', onEdit: () => editOnboardingStep(4) },
                                { label: 'Skills', value: `${data.skills.length} selected`, editLabel: 'Edit skills', onEdit: () => editOnboardingStep(3) },
                                { label: 'Open to Roles', value: `${data.openTo.length} preferences`, editLabel: 'Edit details', onEdit: () => editOnboardingStep(2) },
                                { label: 'Social links', value: `${filledSocialLinks.length} connected`, editLabel: 'Edit details', onEdit: () => editOnboardingStep(2) },
                            ]}
                            error={error}
                        />
                    </Suspense>
                )}
                {error && step !== 4 ? (
                    <div className="onb-alert-error mt-6" role="alert">
                        {error}
                    </div>
                ) : null}
            </StepTransition>

            {/* Step Footer Navigation */}
            <StepFooter
                step={step}
                totalSteps={TOTAL_STEPS}
                canProceed={canProceed()}
                isLoading={isLoading || isCommittingStep}
                loadingLabel={isLoading ? 'Completing...' : 'Saving...'}
                nextLabel={
                    step === 2
                        ? (() => {
                            const index = ONBOARDING_STEP2_SECTIONS.findIndex((section) => section.id === step2Section)
                            const nextSection = ONBOARDING_STEP2_SECTIONS[index + 1]
                            return nextSection ? `Next: ${nextSection.label}` : 'Continue to Skills'
                        })()
                        : 'Continue'
                }
                disabledReason={proceedReason()}
                saveStatus={error ? 'Your entries remain available in this browser.' : isCommittingStep || isLoading ? 'Saving your changes.' : 'Changes are saved in this browser.'}
                onBack={prevStep}
                onNext={nextStep}
                onSubmit={handleSubmit}
            />
        </OnboardingLayout>
    )
}
