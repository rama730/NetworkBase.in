'use client'

import { StepHeader } from '@/components/onboarding/StepHeader'
import ChipSelector from '@/components/onboarding/ChipSelector'
import { SkillPicker } from '@/components/skills/SkillPicker'
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'

interface Step3SkillsProps {
  interestOptions: Array<{ value: string; label: string }>
  selectedSkills: Set<string>
  selectedInterests: Set<string>
  onToggleSkill: (value: string) => void
  onToggleInterest: (value: string) => void
}

const step3Config = STEP_UI_CONFIG.find((s) => s.id === 3)!

export default function Step3Skills({
  interestOptions,
  selectedSkills,
  selectedInterests,
  onToggleSkill,
  onToggleInterest,
}: Step3SkillsProps) {
  return (
    <div className="flex flex-col">
      <StepHeader title={step3Config.title} subtitle={step3Config.subtitle} step={3} totalSteps={4} />

      <div className="flex flex-col gap-6">
        {/* Skills section */}
        <div className="flex flex-col gap-2">
          <p className="onb-field-hint" id="skills-requirement">Add at least one skill to continue. You can select up to 25.</p>
          <SkillPicker
            value={[...selectedSkills]}
            onChange={(nextSkills) => {
              const next = new Set(nextSkills)
              for (const skill of selectedSkills) {
                if (!next.has(skill)) onToggleSkill(skill)
              }
              for (const skill of nextSkills) {
                if (!selectedSkills.has(skill)) onToggleSkill(skill)
              }
            }}
            maxSkills={25}
            label="Skills (required)"
            description="Search across engineering, design, product, business, and human skills."
            className="onb-skill-picker"
          />
          <p className="onb-field-status" role="status" aria-live="polite">{selectedSkills.size} of 25 skills selected.</p>
        </div>

        {/* Interests section */}
        <div className="onb-field">
          <label className="onb-field-label">
            Interests
          </label>
          <p className="onb-field-hint">Optional topics help refine project and collaborator recommendations.</p>
          <ChipSelector
            options={interestOptions}
            selected={selectedInterests}
            onToggle={onToggleInterest}
            variant="multi"
            size="md"
            colorVariant="secondary"
            maxVisible={12}
            expandLabel="Show more"
          />
        </div>
      </div>
    </div>
  )
}
