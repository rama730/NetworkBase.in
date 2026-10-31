'use client'

import { cn } from '@/lib/utils'
import { GENDER_LABELS, ONBOARDING_GENDER_VALUES, type OnboardingGenderIdentity } from '@/lib/onboarding/contracts'
import { choiceChipClass } from '@/components/onboarding/ChipSelector'

interface GenderChoiceProps {
  value: OnboardingGenderIdentity | ''
  onChange: (value: OnboardingGenderIdentity | '') => void
  /** Radios in a group must share a name; two on one page need two names. */
  name?: string
}

/** Single-choice gender, optional and clearable. Native radios, so arrow keys and screen readers work as expected. */
export function GenderChoice({ value, onChange, name = 'genderIdentity' }: GenderChoiceProps) {
  return (
    <fieldset className="onb-field">
      <legend className="onb-field-label">Gender</legend>
      <p id={`${name}-hint`} className="onb-field-hint">Choose “Prefer not to say” or leave this blank.</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-describedby={`${name}-hint`}>
        {ONBOARDING_GENDER_VALUES.map((option) => (
          <label
            key={option}
            className={cn(
              choiceChipClass(value === option),
              'cursor-pointer has-[:focus-visible]:underline has-[:focus-visible]:decoration-2 has-[:focus-visible]:underline-offset-4',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {GENDER_LABELS[option]}
          </label>
        ))}
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="onb-focusable onb-link min-h-11 rounded px-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>
    </fieldset>
  )
}
