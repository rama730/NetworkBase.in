'use client'

import ChipSelector from '@/components/onboarding/ChipSelector'
import { SkillPicker } from '@/components/skills/SkillPicker'
import { PROFILE_FIELD_LIMITS } from '@/lib/validations/profile-fields'

const INTEREST_OPTIONS = [
  'Open Source', 'Startups', 'AI/ML', 'Web3', 'Gaming',
  'Education', 'Healthcare', 'Fintech', 'E-commerce', 'SaaS',
  'Climate Tech', 'Social Impact', 'Creative Tools', 'Developer Tools', 'DevOps',
].map((value) => ({ value, label: value }))

interface Step3SkillsProps {
  skills: string[]
  interests: string[]
  onSkillsChange: (skills: string[]) => void
  onToggleInterest: (value: string) => void
}

export default function Step3Skills({ skills, interests, onSkillsChange, onToggleInterest }: Step3SkillsProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <SkillPicker
          value={skills}
          onChange={onSkillsChange}
          maxSkills={PROFILE_FIELD_LIMITS.tagMaxItems}
          label="Skills (required)"
          description="Search across engineering, design, product, business, and human skills. Add at least one."
          className="onb-skill-picker"
        />
        <p className="onb-field-status" role="status" aria-live="polite">
          {skills.length} of {PROFILE_FIELD_LIMITS.tagMaxItems} skills selected.
        </p>
      </div>

      <div className="onb-field">
        <span id="interests-label" className="onb-field-label">Interests</span>
        <p className="onb-field-hint">Optional topics help refine project and collaborator recommendations.</p>
        <ChipSelector
          options={INTEREST_OPTIONS}
          selected={new Set(interests)}
          onToggle={onToggleInterest}
          labelledBy="interests-label"
        />
      </div>
    </div>
  )
}
