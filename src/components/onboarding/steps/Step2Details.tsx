'use client'

import { useMemo, useState } from 'react'
import { MapPin, Globe, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionNav } from '@/components/onboarding/SectionNav'
import ChipSelector from '@/components/onboarding/ChipSelector'
import type { OnboardingStep2SectionId } from '@/lib/onboarding/config'
import type {
  OnboardingExperienceLevel,
  OnboardingGenderIdentity,
  OnboardingHoursPerWeek,
  OnboardingSocialLinkKey,
} from '@/lib/onboarding/contracts'
import {
  EXPERIENCE_LEVEL_OPTIONS,
  ROLE_PREFERENCE_OPTIONS,
  WEEKLY_CAPACITY_OPTIONS,
} from '@/lib/profile/role-preferences'

// --- Option constants ---

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const

// --- Section definitions for SectionNav ---

const SECTION_NAV_ITEMS = [
  { id: 'identity', label: 'Identity' },
  { id: 'work', label: 'Work prefs' },
  { id: 'profile', label: 'Profile' },
  { id: 'social', label: 'Social' },
] as const

function optionalUrlError(value: string) {
  const normalized = value.trim()
  if (!normalized) return null
  try {
    const url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'Use an http or https address.'
  } catch {
    return 'Enter a valid web address, such as example.com.'
  }
}

// --- Props ---

export interface Step2DetailsProps {
  // Section navigation
  step2Section: OnboardingStep2SectionId
  onSectionChange: (sectionId: OnboardingStep2SectionId) => void

  // Identity section
  genderIdentity: OnboardingGenderIdentity | ''
  pronouns: string
  onGenderChange: (value: OnboardingGenderIdentity | '') => void
  onPronounsChange: (value: string) => void

  // Work section
  experienceLevel: OnboardingExperienceLevel | ''
  hoursPerWeek: OnboardingHoursPerWeek | ''
  openTo: string[]
  onExperienceLevelChange: (value: OnboardingExperienceLevel | '') => void
  onHoursPerWeekChange: (value: OnboardingHoursPerWeek | '') => void
  onToggleOpenTo: (value: string) => void

  // Profile section
  headline: string
  bio: string
  location: string
  website: string
  onHeadlineChange: (value: string) => void
  onBioChange: (value: string) => void
  onLocationChange: (value: string) => void
  onWebsiteChange: (value: string) => void
  isDetectingLocation?: boolean
  locationError?: string | null
  onDetectLocation?: () => void

  // Social section
  socialLinks: Record<OnboardingSocialLinkKey, string>
  onSocialLinkChange: (key: OnboardingSocialLinkKey, value: string) => void
}

/**
 * Step 2 — Profile Details with SectionNav.
 *
 * Visual changes from the original:
 * - SectionNav replaces sticky tabs + completion badges
 * - Identity section: ChipSelector (single mode) for gender, pronouns input
 * - Work section: shadcn Select for experience/hours (2-col grid on desktop),
 *   ChipSelector (multi) for role preferences
 * - Profile section: headline input, bio textarea (112px min-height,
 *   character counter only when content exists), location/website 2-col grid on desktop
 * - Social section: single-column layout, placeholder text showing URL prefix patterns
 * - No Clock3, Users icons in section headers
 * - No "Skip for now" buttons
 * - No sticky positioning on SectionNav
 */
export default function Step2Details({
  step2Section,
  onSectionChange,
  genderIdentity,
  pronouns,
  onGenderChange,
  onPronounsChange,
  experienceLevel,
  hoursPerWeek,
  openTo,
  onExperienceLevelChange,
  onHoursPerWeekChange,
  onToggleOpenTo,
  headline,
  bio,
  location,
  website,
  onHeadlineChange,
  onBioChange,
  onLocationChange,
  onWebsiteChange,
  isDetectingLocation = false,
  locationError,
  onDetectLocation,
  socialLinks,
  onSocialLinkChange,
}: Step2DetailsProps) {
  // Compute completed sections for SectionNav dot indicators
  const completedSections = useMemo(() => {
    const completed = new Set<string>()
    if (genderIdentity || pronouns) completed.add('identity')
    if (experienceLevel || hoursPerWeek || openTo.length > 0) completed.add('work')
    if (headline || bio || location || website) completed.add('profile')
    if (Object.values(socialLinks).some(Boolean)) completed.add('social')
    return completed
  }, [genderIdentity, pronouns, experienceLevel, hoursPerWeek, openTo, headline, bio, location, website, socialLinks])

  // Memoize selected sets for ChipSelector
  const selectedGender = useMemo(
    () => (genderIdentity ? new Set([genderIdentity]) : new Set<string>()),
    [genderIdentity]
  )
  const selectedOpenTo = useMemo(() => new Set(openTo), [openTo])

  return (
    <div className="flex flex-col gap-8">
      {/* Section navigation keeps the active detail group in the document flow. */}
      <SectionNav
        sections={[...SECTION_NAV_ITEMS]}
        activeSection={step2Section}
        completedSections={completedSections}
        onSectionChange={(id) => onSectionChange(id as OnboardingStep2SectionId)}
      />

      {/* One active tab panel keeps the four optional detail groups manageable. */}
      <div
        id={`onb-details-${step2Section}-panel`}
        role="tabpanel"
        aria-labelledby={`onb-details-${step2Section}`}
        tabIndex={0}
        className="outline-none"
      >
        {step2Section === 'identity' && (
          <IdentitySection
            selectedGender={selectedGender}
            onGenderChange={onGenderChange}
            pronouns={pronouns}
            onPronounsChange={onPronounsChange}
          />
        )}

        {step2Section === 'work' && (
          <WorkSection
            experienceLevel={experienceLevel}
            hoursPerWeek={hoursPerWeek}
            selectedOpenTo={selectedOpenTo}
            onExperienceLevelChange={onExperienceLevelChange}
            onHoursPerWeekChange={onHoursPerWeekChange}
            onToggleOpenTo={onToggleOpenTo}
          />
        )}

        {step2Section === 'profile' && (
          <ProfileSection
            headline={headline}
            bio={bio}
            location={location}
            website={website}
            onHeadlineChange={onHeadlineChange}
            onBioChange={onBioChange}
            onLocationChange={onLocationChange}
            onWebsiteChange={onWebsiteChange}
          isDetectingLocation={isDetectingLocation}
          locationError={locationError}
            onDetectLocation={onDetectLocation}
          />
        )}

        {step2Section === 'social' && (
          <SocialSection
            socialLinks={socialLinks}
            onSocialLinkChange={onSocialLinkChange}
          />
        )}
      </div>
    </div>
  )
}

// --- Identity Section ---

function IdentitySection({
  selectedGender,
  onGenderChange,
  pronouns,
  onPronounsChange,
}: {
  selectedGender: Set<string>
  onGenderChange: (value: OnboardingGenderIdentity | '') => void
  pronouns: string
  onPronounsChange: (value: string) => void
}) {
  const handleGenderToggle = (value: string) => {
    // Single mode: if already selected, deselect; otherwise select
    if (selectedGender.has(value)) {
      onGenderChange('')
    } else {
      onGenderChange(value as OnboardingGenderIdentity)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="onb-section-kicker">Identity context</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-[1.28] tracking-[-0.01em] text-foreground">How you identify</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">These details are optional and remain editable from your profile.</p>
      </div>
      {/* Gender — ChipSelector single mode */}
      <div className="onb-field">
        <label className="onb-field-label">
          Gender (optional)
        </label>
        <p className="onb-field-hint">Choose “Prefer not to say” or leave this blank.</p>
        <ChipSelector
          options={[...GENDER_OPTIONS]}
          selected={selectedGender}
          onToggle={handleGenderToggle}
          variant="single"
          size="md"
          colorVariant="primary"
        />
      </div>

      {/* Pronouns input */}
      <div className="onb-field">
        <label htmlFor="pronouns" className="onb-field-label">
          Pronouns (optional)
        </label>
        <Input
          id="pronouns"
          placeholder="e.g. they/them"
          value={pronouns}
          onChange={(e) => onPronounsChange(e.target.value)}
          className="onb-input"
        />
        <p className="onb-field-hint">
          You can always change these in settings
        </p>
      </div>
    </div>
  )
}

// --- Work Section ---

function WorkSection({
  experienceLevel,
  hoursPerWeek,
  selectedOpenTo,
  onExperienceLevelChange,
  onHoursPerWeekChange,
  onToggleOpenTo,
}: {
  experienceLevel: OnboardingExperienceLevel | ''
  hoursPerWeek: OnboardingHoursPerWeek | ''
  selectedOpenTo: Set<string>
  onExperienceLevelChange: (value: OnboardingExperienceLevel | '') => void
  onHoursPerWeekChange: (value: OnboardingHoursPerWeek | '') => void
  onToggleOpenTo: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="onb-section-kicker">Professional information</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-[1.28] tracking-[-0.01em] text-foreground">Your work preferences</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Share the type of collaboration that works for you.</p>
      </div>
      {/* Experience level + Hours per week — 2-col grid on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="onb-field">
          <label htmlFor="experienceLevel" className="onb-field-label">
            Experience level
          </label>
          <Select
            value={experienceLevel || undefined}
            onValueChange={(val) => onExperienceLevelChange(val as OnboardingExperienceLevel)}
          >
            <SelectTrigger id="experienceLevel" className="onb-select-trigger">
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              {EXPERIENCE_LEVEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="onb-field">
          <label htmlFor="hoursPerWeek" className="onb-field-label">
            Weekly capacity
          </label>
          <Select
            value={hoursPerWeek || undefined}
            onValueChange={(val) => onHoursPerWeekChange(val as OnboardingHoursPerWeek)}
          >
            <SelectTrigger id="hoursPerWeek" className="onb-select-trigger">
              <SelectValue placeholder="Select hours" />
            </SelectTrigger>
            <SelectContent>
              {WEEKLY_CAPACITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Open to Roles — ChipSelector multi mode */}
      <div className="onb-field">
        <label className="onb-field-label">Open to roles</label>
        <ChipSelector
          options={[...ROLE_PREFERENCE_OPTIONS]}
          selected={selectedOpenTo}
          onToggle={onToggleOpenTo}
          variant="multi"
          size="md"
          colorVariant="primary"
        />
      </div>
    </div>
  )
}

// --- Profile Section ---

function ProfileSection({
  headline,
  bio,
  location,
  website,
  onHeadlineChange,
  onBioChange,
  onLocationChange,
  onWebsiteChange,
  isDetectingLocation,
  locationError,
  onDetectLocation,
}: {
  headline: string
  bio: string
  location: string
  website: string
  onHeadlineChange: (value: string) => void
  onBioChange: (value: string) => void
  onLocationChange: (value: string) => void
  onWebsiteChange: (value: string) => void
  isDetectingLocation?: boolean
  locationError?: string | null
  onDetectLocation?: () => void
}) {
  const [websiteError, setWebsiteError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="onb-section-kicker">Profile</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-[1.28] tracking-[-0.01em] text-foreground">Introduce your work</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Use a concise headline and enough context for collaborators to recognise your strengths.</p>
      </div>
      {/* Headline */}
      <div className="onb-field">
        <label htmlFor="headline" className="onb-field-label">
          Headline
        </label>
        <Input
          id="headline"
          placeholder="Full Stack Developer | OSS"
          value={headline}
          onChange={(e) => onHeadlineChange(e.target.value)}
          className="onb-input"
        />
        <p className="onb-field-hint">
          A short tagline for your profile
        </p>
      </div>

      {/* Bio */}
      <div className="onb-field">
        <label htmlFor="bio" className="onb-field-label">
          Bio
        </label>
        <textarea
          id="bio"
          placeholder="Tell us about yourself..."
          value={bio}
          onChange={(e) => onBioChange(e.target.value)}
          className={cn('onb-textarea w-full text-[15px] leading-[1.5] text-foreground placeholder:text-muted-foreground')}
          maxLength={500}
        />
        {/* Character counter — only visible when bio has content */}
        {bio.length > 0 && (
          <p className="font-mono text-[12px] text-muted-foreground text-right">
            {bio.length}/500
          </p>
        )}
      </div>

      {/* Location + Website — 2-col grid on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="onb-field">
          <label htmlFor="location" className="onb-field-label">
            Location
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="location"
              placeholder="San Francisco, CA"
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              className="onb-input pl-10"
            />
          </div>
          {onDetectLocation && (
            <button
              type="button"
              onClick={onDetectLocation}
              disabled={isDetectingLocation}
              className="onb-focusable inline-flex min-h-[44px] self-start items-center gap-1 rounded text-[13px] text-primary hover:underline disabled:opacity-50 sm:min-h-0"
            >
              {isDetectingLocation ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {isDetectingLocation ? 'Detecting...' : 'Use my location'}
            </button>
          )}
          {locationError ? <p className="onb-field-error" role="alert">{locationError}</p> : null}
        </div>

        <div className="onb-field">
          <label htmlFor="website" className="onb-field-label">
            Website
          </label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="website"
              placeholder="https://yoursite.com"
              value={website}
              onChange={(e) => onWebsiteChange(e.target.value)}
              onBlur={() => setWebsiteError(optionalUrlError(website))}
              aria-invalid={Boolean(websiteError)}
              aria-describedby={websiteError ? 'website-error' : undefined}
              className="onb-input pl-10"
            />
          </div>
          {websiteError ? <p id="website-error" className="onb-field-error" role="alert">{websiteError}</p> : null}
        </div>
      </div>
    </div>
  )
}

// --- Social Section ---

function SocialSection({
  socialLinks,
  onSocialLinkChange,
}: {
  socialLinks: Record<OnboardingSocialLinkKey, string>
  onSocialLinkChange: (key: OnboardingSocialLinkKey, value: string) => void
}) {
  const [errors, setErrors] = useState<Partial<Record<OnboardingSocialLinkKey, string>>>({})

  const validate = (key: OnboardingSocialLinkKey) => {
    setErrors((current) => ({ ...current, [key]: optionalUrlError(socialLinks[key]) || undefined }))
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="onb-section-kicker">Social destinations</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-[1.28] tracking-[-0.01em] text-foreground">Links you want to share</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Optional. Add only destinations you are comfortable displaying on your profile.</p>
      </div>

      {/* Single-column layout for social links */}
      <div className="flex flex-col gap-4">
        <div className="onb-field">
          <label htmlFor="githubLink" className="onb-field-label">
            GitHub
          </label>
          <Input
            id="githubLink"
            placeholder="github.com/"
            value={socialLinks.github}
            onChange={(e) => onSocialLinkChange('github', e.target.value)}
            onBlur={() => validate('github')}
            aria-invalid={Boolean(errors.github)}
            aria-describedby={errors.github ? 'github-link-error' : undefined}
            className="onb-input"
          />
          {errors.github ? <p id="github-link-error" className="onb-field-error" role="alert">{errors.github}</p> : null}
        </div>

        <div className="onb-field">
          <label htmlFor="linkedinLink" className="onb-field-label">
            LinkedIn
          </label>
          <Input
            id="linkedinLink"
            placeholder="linkedin.com/in/"
            value={socialLinks.linkedin}
            onChange={(e) => onSocialLinkChange('linkedin', e.target.value)}
            onBlur={() => validate('linkedin')}
            aria-invalid={Boolean(errors.linkedin)}
            aria-describedby={errors.linkedin ? 'linkedin-link-error' : undefined}
            className="onb-input"
          />
          {errors.linkedin ? <p id="linkedin-link-error" className="onb-field-error" role="alert">{errors.linkedin}</p> : null}
        </div>

        <div className="onb-field">
          <label htmlFor="xLink" className="onb-field-label">
            X (Twitter)
          </label>
          <Input
            id="xLink"
            placeholder="x.com/"
            value={socialLinks.x}
            onChange={(e) => onSocialLinkChange('x', e.target.value)}
            onBlur={() => validate('x')}
            aria-invalid={Boolean(errors.x)}
            aria-describedby={errors.x ? 'x-link-error' : undefined}
            className="onb-input"
          />
          {errors.x ? <p id="x-link-error" className="onb-field-error" role="alert">{errors.x}</p> : null}
        </div>

        <div className="onb-field">
          <label htmlFor="portfolioLink" className="onb-field-label">
            Portfolio
          </label>
          <Input
            id="portfolioLink"
            placeholder="https://"
            value={socialLinks.portfolio}
            onChange={(e) => onSocialLinkChange('portfolio', e.target.value)}
            onBlur={() => validate('portfolio')}
            aria-invalid={Boolean(errors.portfolio)}
            aria-describedby={errors.portfolio ? 'portfolio-link-error' : undefined}
            className="onb-input"
          />
          {errors.portfolio ? <p id="portfolio-link-error" className="onb-field-error" role="alert">{errors.portfolio}</p> : null}
        </div>
      </div>
    </div>
  )
}
