'use client'

import { useState } from 'react'
import { Globe, Loader2, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import ChipSelector from '@/components/onboarding/ChipSelector'
import { GenderChoice } from '@/components/profile/GenderChoice'
import { urlFieldError } from '@/lib/onboarding/block-reason'
import {
  ONBOARDING_SOCIAL_KEYS,
  type OnboardingSocialLinkKey,
} from '@/lib/onboarding/contracts'
import type { OnboardingData } from '@/lib/onboarding/form-data'
import { PROFILE_FIELD_LIMITS as LIMITS } from '@/lib/validations/profile-fields'
import { EXPERIENCE_LEVEL_OPTIONS, ROLE_PREFERENCE_OPTIONS, WEEKLY_CAPACITY_OPTIONS } from '@/lib/profile/role-preferences'

const SOCIAL_FIELDS: Record<OnboardingSocialLinkKey, { label: string; placeholder: string }> = {
  github: { label: 'GitHub', placeholder: 'github.com/' },
  linkedin: { label: 'LinkedIn', placeholder: 'linkedin.com/in/' },
  x: { label: 'X (Twitter)', placeholder: 'x.com/' },
  portfolio: { label: 'Portfolio', placeholder: 'https://' },
}

type Details = Pick<
  OnboardingData,
  'genderIdentity' | 'pronouns' | 'experienceLevel' | 'hoursPerWeek' | 'openTo' | 'headline' | 'bio' | 'location' | 'website' | 'socialLinks'
>

export interface Step2DetailsProps {
  data: Details
  onChange: (updates: Partial<Details>) => void
  onToggleOpenTo: (value: string) => void
  onSocialLinkChange: (key: OnboardingSocialLinkKey, value: string) => void
  isDetectingLocation: boolean
  locationError: string | null
  onDetectLocation: () => void
  /** After a refused Continue: show every invalid link, not just the ones already left. */
  showErrors: boolean
}

function SectionHeading({ id, kicker, title, description }: { id: string; kicker: string; title: string; description: string }) {
  return (
    <div>
      <p className="onb-section-kicker">{kicker}</p>
      <h2 id={id} tabIndex={-1} className="mt-2 text-[20px] font-semibold leading-[1.28] tracking-[-0.01em] text-foreground outline-none">
        {title}
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</p>
    </div>
  )
}

const selectClass =
  'onb-select-trigger h-[var(--ui-control-height)] w-full px-3 text-[14px] text-foreground'

/**
 * Step 2: everything optional, on one page. Four groups in the order people finish them: what you do, how you
 * introduce it, where to find you, then (last, and clearly optional) how you identify.
 */
export default function Step2Details({
  data,
  onChange,
  onToggleOpenTo,
  onSocialLinkChange,
  isDetectingLocation,
  locationError,
  onDetectLocation,
  showErrors,
}: Step2DetailsProps) {
  // A link's error appears once the person has left that field (or pressed a blocked Continue).
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const touch = (key: string) => setTouched((current) => new Set(current).add(key))
  const errorFor = (key: string, value: string, max: number) => (touched.has(key) || showErrors ? urlFieldError(value, max) : null)
  const websiteError = errorFor('website', data.website, LIMITS.websiteMax)

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="onb-work" className="flex flex-col gap-6">
        <SectionHeading id="onb-work" kicker="Professional information" title="Your work preferences" description="Share the type of collaboration that works for you." />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="onb-field">
            <label htmlFor="experienceLevel" className="onb-field-label">Experience level</label>
            <select
              id="experienceLevel"
              value={data.experienceLevel}
              onChange={(event) => onChange({ experienceLevel: event.target.value as Details['experienceLevel'] })}
              className={selectClass}
            >
              <option value="">Not set</option>
              {EXPERIENCE_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="onb-field">
            <label htmlFor="hoursPerWeek" className="onb-field-label">Weekly capacity</label>
            <select
              id="hoursPerWeek"
              value={data.hoursPerWeek}
              onChange={(event) => onChange({ hoursPerWeek: event.target.value as Details['hoursPerWeek'] })}
              className={selectClass}
            >
              <option value="">Not set</option>
              {WEEKLY_CAPACITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="onb-field">
          <span id="open-to-label" className="onb-field-label">Open to roles</span>
          <ChipSelector
            options={[...ROLE_PREFERENCE_OPTIONS]}
            selected={new Set(data.openTo)}
            onToggle={onToggleOpenTo}
            labelledBy="open-to-label"
          />
        </div>
      </section>

      <section aria-labelledby="onb-profile" className="flex flex-col gap-6">
        <SectionHeading id="onb-profile" kicker="Profile" title="Introduce your work" description="A concise headline and enough context for collaborators to recognise your strengths." />
        <div className="onb-field">
          <label htmlFor="headline" className="onb-field-label">Headline</label>
          <Input
            id="headline"
            placeholder="Full Stack Developer | OSS"
            value={data.headline}
            onChange={(event) => onChange({ headline: event.target.value })}
            className="onb-input"
            maxLength={LIMITS.headlineMax}
            aria-describedby="headline-hint"
          />
          <p id="headline-hint" className="onb-field-hint">A short tagline for your profile.</p>
        </div>
        <div className="onb-field">
          <label htmlFor="bio" className="onb-field-label">Bio</label>
          <textarea
            id="bio"
            placeholder="Tell us about yourself..."
            value={data.bio}
            onChange={(event) => onChange({ bio: event.target.value })}
            className={cn('onb-textarea w-full text-[15px] leading-[1.5] text-foreground placeholder:text-muted-foreground')}
            maxLength={LIMITS.bioMax}
            aria-describedby="bio-count"
          />
          <p id="bio-count" className="text-right font-mono text-[12px] text-muted-foreground">
            {data.bio.length > 0 ? `${data.bio.length}/${LIMITS.bioMax}` : ''}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="onb-field">
            <label htmlFor="location" className="onb-field-label">Location</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="location"
                placeholder="San Francisco, CA"
                value={data.location}
                onChange={(event) => onChange({ location: event.target.value })}
                className="onb-input pl-10"
                maxLength={LIMITS.locationMax}
                autoComplete="address-level2"
                aria-describedby={locationError ? 'location-error' : undefined}
              />
            </div>
            <button
              type="button"
              onClick={onDetectLocation}
              disabled={isDetectingLocation}
              className="onb-focusable onb-link inline-flex min-h-11 items-center gap-1 self-start rounded text-[13px] text-primary hover:underline disabled:opacity-50"
            >
              {isDetectingLocation ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
              {isDetectingLocation ? 'Detecting…' : 'Use my location'}
            </button>
            {locationError ? <p id="location-error" className="onb-field-error" role="alert">{locationError}</p> : null}
          </div>
          <div className="onb-field">
            <label htmlFor="website" className="onb-field-label">Website</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="website"
                placeholder="https://yoursite.com"
                value={data.website}
                onChange={(event) => onChange({ website: event.target.value })}
                onBlur={() => touch('website')}
                aria-invalid={Boolean(websiteError)}
                aria-describedby={websiteError ? 'website-error' : undefined}
                className="onb-input pl-10"
                inputMode="url"
                autoCapitalize="none"
              />
            </div>
            {websiteError ? <p id="website-error" className="onb-field-error" role="alert">{websiteError}</p> : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="onb-social" className="flex flex-col gap-6">
        <SectionHeading id="onb-social" kicker="Social destinations" title="Links you want to share" description="Add only destinations you are comfortable displaying on your profile." />
        <div className="flex flex-col gap-4">
          {ONBOARDING_SOCIAL_KEYS.map((key) => {
            const error = errorFor(key, data.socialLinks[key], LIMITS.socialUrlMax)
            return (
              <div className="onb-field" key={key}>
                <label htmlFor={`${key}-link`} className="onb-field-label">{SOCIAL_FIELDS[key].label}</label>
                <Input
                  id={`${key}-link`}
                  placeholder={SOCIAL_FIELDS[key].placeholder}
                  value={data.socialLinks[key]}
                  onChange={(event) => onSocialLinkChange(key, event.target.value)}
                  onBlur={() => touch(key)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${key}-link-error` : undefined}
                  className="onb-input"
                  maxLength={LIMITS.socialUrlMax}
                  inputMode="url"
                  autoCapitalize="none"
                />
                {error ? <p id={`${key}-link-error`} className="onb-field-error" role="alert">{error}</p> : null}
              </div>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="onb-about" className="flex flex-col gap-6">
        <SectionHeading id="onb-about" kicker="About you" title="How you identify" description="Optional, and you can change it from your profile later." />
        <GenderChoice value={data.genderIdentity} onChange={(genderIdentity) => onChange({ genderIdentity })} />
        <div className="onb-field">
          <label htmlFor="pronouns" className="onb-field-label">Pronouns</label>
          <Input
            id="pronouns"
            placeholder="e.g. they/them"
            value={data.pronouns}
            onChange={(event) => onChange({ pronouns: event.target.value })}
            className="onb-input"
            maxLength={LIMITS.pronounsMax}
          />
        </div>
      </section>
    </div>
  )
}
