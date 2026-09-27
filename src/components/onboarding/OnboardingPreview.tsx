'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout'
import { MobileProgressBar } from '@/components/onboarding/MobileProgressBar'
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar'
import { StepFooter } from '@/components/onboarding/StepFooter'
import { StepHeader } from '@/components/onboarding/StepHeader'
import { StepTransition } from '@/components/onboarding/StepTransition'
import { Step1Identity } from '@/components/onboarding/steps/Step1Identity'
import Step2Details from '@/components/onboarding/steps/Step2Details'
import Step3Skills from '@/components/onboarding/steps/Step3Skills'
import { Step4Privacy } from '@/components/onboarding/steps/Step4Privacy'
import { Button } from '@/components/ui/button'
import { ONBOARDING_SOCIAL_KEYS, type OnboardingExperienceLevel, type OnboardingGenderIdentity, type OnboardingHoursPerWeek, type OnboardingMessagePrivacy, type OnboardingSocialLinkKey, type OnboardingVisibility } from '@/lib/onboarding/contracts'
import { type OnboardingStep2SectionId } from '@/lib/onboarding/config'
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'

const INTEREST_SUGGESTIONS = [
  'Open Source', 'Startups', 'AI/ML', 'Web3', 'Gaming', 'Education', 'Healthcare',
  'Fintech', 'E-commerce', 'SaaS', 'Climate Tech', 'Social Impact', 'Creative Tools',
  'Developer Tools', 'DevOps',
]

const PREVIEW_DEFAULTS = {
  fullName: 'Jordan Rivera',
  username: 'jordan.preview',
  headline: 'Product-minded engineer building useful tools.',
  bio: 'I enjoy working with thoughtful people on products that make complex work feel simple.',
  location: 'Bengaluru, India',
  website: 'https://example.com',
  genderIdentity: '' as OnboardingGenderIdentity | '',
  pronouns: 'they/them',
  experienceLevel: 'mid' as OnboardingExperienceLevel | '',
  hoursPerWeek: 'h_10_20' as OnboardingHoursPerWeek | '',
  openTo: ['Collaborating', 'Mentoring'],
  skills: ['TypeScript', 'Product design'],
  interests: ['Open Source', 'Developer Tools'],
  messagePrivacy: 'connections' as OnboardingMessagePrivacy,
  visibility: 'public' as OnboardingVisibility,
  socialLinks: {
    github: 'jordan-preview',
    linkedin: '',
    x: '',
    portfolio: '',
  } satisfies Record<OnboardingSocialLinkKey, string>,
}

function makeInitialState() {
  return {
    ...PREVIEW_DEFAULTS,
    openTo: [...PREVIEW_DEFAULTS.openTo],
    skills: [...PREVIEW_DEFAULTS.skills],
    interests: [...PREVIEW_DEFAULTS.interests],
    socialLinks: { ...PREVIEW_DEFAULTS.socialLinks },
    avatarUrl: '',
  }
}

/**
 * Development-only, client-only rendering harness for inspecting every
 * onboarding state without an authenticated profile or persisted side effect.
 */
export function OnboardingPreview() {
  const [step, setStep] = useState(1)
  const [step2Section, setStep2Section] = useState<OnboardingStep2SectionId>('identity')
  const [direction, setDirection] = useState<'forward' | 'backward' | 'section'>('forward')
  const [finished, setFinished] = useState(false)
  const [data, setData] = useState(makeInitialState)
  const previewAvatarUrlRef = useRef<string | null>(null)

  useEffect(() => () => {
    if (previewAvatarUrlRef.current) URL.revokeObjectURL(previewAvatarUrlRef.current)
  }, [])

  const completedSteps = useMemo(
    () => new Set(Array.from({ length: Math.max(0, step - 1) }, (_, index) => index + 1)),
    [step],
  )
  const sidebarStepLabels = useMemo(
    () => STEP_UI_CONFIG.map((config) => ({ title: config.sidebarLabel, subtitle: config.subtitle })),
    [],
  )
  const mobileStepLabels = useMemo(() => STEP_UI_CONFIG.map((config) => config.sidebarLabel), [])
  const currentConfig = STEP_UI_CONFIG[step - 1]

  const update = <Key extends keyof typeof data>(key: Key, value: (typeof data)[Key]) => {
    setData((current) => ({ ...current, [key]: value }))
  }

  const toggleString = (key: 'skills' | 'interests' | 'openTo', value: string) => {
    setData((current) => {
      const selected = new Set(current[key])
      if (selected.has(value)) selected.delete(value)
      else selected.add(value)
      return { ...current, [key]: [...selected] }
    })
  }

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (previewAvatarUrlRef.current) URL.revokeObjectURL(previewAvatarUrlRef.current)
    const previewUrl = URL.createObjectURL(file)
    previewAvatarUrlRef.current = previewUrl
    update('avatarUrl', previewUrl)
  }

  const canProceed = step === 1
    ? data.fullName.trim().length >= 2 && data.username.trim().length >= 3
    : step === 3
      ? data.skills.length > 0
      : true
  const proceedReason = step === 1 && data.fullName.trim().length < 2
    ? 'Enter your full name to continue.'
    : step === 1 && data.username.trim().length < 3
      ? 'Enter a username with at least 3 characters to continue.'
      : step === 3 && data.skills.length === 0
        ? 'Add at least one skill to continue.'
        : undefined
  const next = () => {
    if (!canProceed) return
    setDirection('forward')
    setStep((current) => Math.min(4, current + 1))
  }
  const back = () => {
    setDirection('backward')
    setStep((current) => Math.max(1, current - 1))
  }
  const editStep = (target: number) => {
    setDirection(target < step ? 'backward' : 'forward')
    if (target === 2) setStep2Section('profile')
    setStep(target)
  }
  const restart = () => {
    if (previewAvatarUrlRef.current) URL.revokeObjectURL(previewAvatarUrlRef.current)
    previewAvatarUrlRef.current = null
    setData(makeInitialState())
    setStep2Section('identity')
    setDirection('backward')
    setStep(1)
    setFinished(false)
  }

  return (
    <OnboardingLayout
      sidebar={
        <OnboardingSidebar
          currentStep={finished ? 4 : step}
          totalSteps={4}
          stepLabels={sidebarStepLabels}
          completedSteps={finished ? new Set([1, 2, 3, 4]) : completedSteps}
        />
      }
      mobileProgress={
        <MobileProgressBar
          currentStep={finished ? 4 : step}
          totalSteps={4}
          stepLabels={mobileStepLabels}
          completedThrough={finished ? 4 : step - 1}
        />
      }
    >
      {finished ? (
        <div className="flex min-h-[45vh] flex-col justify-center">
          <p className="onb-step-kicker">Preview complete</p>
          <h1 className="text-[30px] font-semibold leading-[1.28] tracking-[-0.02em] text-foreground">
            All four stages are ready to review.
          </h1>
          <p className="mt-3 max-w-[52ch] text-[13px] leading-5 text-muted-foreground">
            This preview does not create a profile, save a draft, upload a photo, or change onboarding status.
          </p>
          <div className="mt-6">
            <Button className="onb-focusable min-h-[44px]" variant="outline" type="button" onClick={restart}>
              Restart preview
            </Button>
          </div>
        </div>
      ) : (
        <>
          <StepTransition step={step} transitionKey={`${step}:${step === 2 ? step2Section : 'main'}`} direction={direction}>
            {(step === 1 || step === 2) && currentConfig ? (
              <StepHeader title={currentConfig.title} subtitle={currentConfig.subtitle} step={step} totalSteps={4} />
            ) : null}

            {step === 1 ? (
              <Step1Identity
                fullName={data.fullName}
                username={data.username}
                avatarUrl={data.avatarUrl}
                isUploadingAvatar={false}
                onFullNameChange={(value) => update('fullName', value)}
                onUsernameChange={(value) => update('username', value)}
                onAvatarChange={handleAvatarChange}
                onUsernameStatusChange={() => undefined}
                allowRemoteUsernameChecks={false}
              />
            ) : null}

            {step === 2 ? (
              <Step2Details
                step2Section={step2Section}
                onSectionChange={(section) => {
                  setDirection('section')
                  setStep2Section(section)
                }}
                genderIdentity={data.genderIdentity}
                pronouns={data.pronouns}
                onGenderChange={(value) => update('genderIdentity', value)}
                onPronounsChange={(value) => update('pronouns', value)}
                experienceLevel={data.experienceLevel}
                hoursPerWeek={data.hoursPerWeek}
                openTo={data.openTo}
                onExperienceLevelChange={(value) => update('experienceLevel', value)}
                onHoursPerWeekChange={(value) => update('hoursPerWeek', value)}
                onToggleOpenTo={(value) => toggleString('openTo', value)}
                headline={data.headline}
                bio={data.bio}
                location={data.location}
                website={data.website}
                onHeadlineChange={(value) => update('headline', value)}
                onBioChange={(value) => update('bio', value)}
                onLocationChange={(value) => update('location', value)}
                onWebsiteChange={(value) => update('website', value)}
                socialLinks={data.socialLinks}
                onSocialLinkChange={(key, value) => update('socialLinks', { ...data.socialLinks, [key]: value })}
              />
            ) : null}

            {step === 3 ? (
              <Step3Skills
                interestOptions={INTEREST_SUGGESTIONS.map((value) => ({ value, label: value }))}
                selectedSkills={new Set(data.skills)}
                selectedInterests={new Set(data.interests)}
                onToggleSkill={(value) => toggleString('skills', value)}
                onToggleInterest={(value) => toggleString('interests', value)}
              />
            ) : null}

            {step === 4 ? (
              <Step4Privacy
                visibility={data.visibility}
                messagePrivacy={data.messagePrivacy}
                onVisibilityChange={(value) => update('visibility', value)}
                onMessagePrivacyChange={(value) => update('messagePrivacy', value)}
                summaryItems={[
                  { label: `@${data.username}`, value: data.fullName },
                  { label: 'Visibility', value: data.visibility === 'public' ? 'Public' : data.visibility === 'connections' ? 'Connections only' : 'Private', editLabel: 'Edit privacy', onEdit: () => editStep(4) },
                  { label: 'Messages', value: data.messagePrivacy === 'connections' ? 'Connections only' : 'Everyone', editLabel: 'Edit privacy', onEdit: () => editStep(4) },
                  { label: 'Skills', value: `${data.skills.length} selected`, editLabel: 'Edit skills', onEdit: () => editStep(3) },
                  { label: 'Open to roles', value: `${data.openTo.length} preferences`, editLabel: 'Edit details', onEdit: () => editStep(2) },
                  { label: 'Social links', value: `${ONBOARDING_SOCIAL_KEYS.filter((key) => data.socialLinks[key]).length} connected`, editLabel: 'Edit details', onEdit: () => editStep(2) },
                ]}
              />
            ) : null}
          </StepTransition>

          <StepFooter
            step={step}
            totalSteps={4}
            canProceed={canProceed}
            isLoading={false}
            disabledReason={proceedReason}
            saveStatus="Preview changes stay in this browser tab."
            onBack={back}
            onNext={next}
            onSubmit={() => setFinished(true)}
          />
        </>
      )}
    </OnboardingLayout>
  )
}
