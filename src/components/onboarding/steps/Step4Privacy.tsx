'use client'

import { PixelIcon } from '@/components/auth/pixel'
import {
  MESSAGE_PRIVACY_CHOICES,
  VISIBILITY_CHOICES,
  type OnboardingMessagePrivacy,
  type OnboardingVisibility,
} from '@/lib/onboarding/contracts'

type PrivacyChoice = { value: string; label: string; description: string }

const VISIBILITY_CONTEXT: Record<OnboardingVisibility, string> = {
  public: 'Your profile can be discovered by anyone using NetworkBase.',
  connections: 'Your profile is only available to people in your network.',
  private: 'Your profile will not appear in Discovery or people search.',
}

const MESSAGE_CONTEXT: Record<OnboardingMessagePrivacy, string> = {
  everyone: 'Anyone on NetworkBase can start a conversation with you.',
  connections: 'New conversations are limited to people in your network.',
}

export interface ReviewSummaryItem {
  label: string
  value: string
  /** Where the person fixes this: absent for the choices made on this very step. */
  onEdit?: () => void
  /** False when nothing is added yet: an empty box instead of the pixel tick. */
  done?: boolean
}

interface Step4PrivacyProps {
  visibility: OnboardingVisibility
  messagePrivacy: OnboardingMessagePrivacy
  onVisibilityChange: (value: OnboardingVisibility) => void
  onMessagePrivacyChange: (value: OnboardingMessagePrivacy) => void
  /** What will be saved, with a way back to each part. */
  summaryItems: ReviewSummaryItem[]
}

interface PrivacyChoiceGroupProps {
  id: string
  choices: PrivacyChoice[]
  selected: string
  onChange: (value: string) => void
}

function PrivacyChoiceGroup({ id, choices, selected, onChange }: PrivacyChoiceGroupProps) {
  return (
    <div role="radiogroup" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="onb-privacy-choice-list">
      {choices.map((choice) => {
        const isSelected = choice.value === selected
        const choiceId = `${id}-${choice.value}`

        return (
          <div key={choice.value} className="onb-privacy-choice-option">
            <input
              id={choiceId}
              name={id}
              type="radio"
              value={choice.value}
              checked={isSelected}
              onChange={() => onChange(choice.value)}
              className="onb-privacy-choice-input"
            />
            <label
              htmlFor={choiceId}
              className="onb-privacy-choice"
            >
              <span className="onb-privacy-choice-copy">
                <span className="onb-privacy-choice-label">{choice.label}</span>
                <span className="onb-privacy-choice-description">{choice.description}</span>
              </span>
              <span className="onb-privacy-choice-indicator" aria-hidden="true"><span /></span>
            </label>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Step 4 keeps the existing privacy model intact, while presenting the choices
 * in the order a person makes them: discoverability, conversation access, then
 * a concise final review before profile creation.
 */
export function Step4Privacy({
  visibility,
  messagePrivacy,
  onVisibilityChange,
  onMessagePrivacyChange,
  summaryItems,
}: Step4PrivacyProps) {
  return (
    <div className="onb-privacy-step">
      <section className="onb-privacy-section" aria-labelledby="profile-visibility-title">
        <p className="onb-section-kicker">Profile access</p>
        <h2 id="profile-visibility-title" className="onb-privacy-section-title">Who can discover you?</h2>
        <p id="profile-visibility-description" className="onb-privacy-section-description">
          This controls how your profile appears in Discovery and people search.
        </p>
        <PrivacyChoiceGroup
          id="profile-visibility"
          choices={VISIBILITY_CHOICES as PrivacyChoice[]}
          selected={visibility}
          onChange={(value) => onVisibilityChange(value as OnboardingVisibility)}
        />
        <p className="onb-privacy-context" aria-live="polite">{VISIBILITY_CONTEXT[visibility]}</p>
        {visibility === 'public' ? (
          <p className="onb-privacy-disclosure">Public profiles can be viewed without an account and may be indexed or cached. Do not add confidential information.</p>
        ) : null}
      </section>

      <section className="onb-privacy-section onb-privacy-section--separated" aria-labelledby="message-privacy-title">
        <p className="onb-section-kicker">Messages</p>
        <h2 id="message-privacy-title" className="onb-privacy-section-title">Who can start a conversation?</h2>
        <p id="message-privacy-description" className="onb-privacy-section-description">
          Choose who can send you a first message. Existing conversations are not affected.
        </p>
        <PrivacyChoiceGroup
          id="message-privacy"
          choices={MESSAGE_PRIVACY_CHOICES as PrivacyChoice[]}
          selected={messagePrivacy}
          onChange={(value) => onMessagePrivacyChange(value as OnboardingMessagePrivacy)}
        />
        <p className="onb-privacy-context" aria-live="polite">{MESSAGE_CONTEXT[messagePrivacy]}</p>
      </section>

      <aside className="onb-privacy-review" aria-labelledby="privacy-review-title">
        <div>
          <p className="onb-section-kicker">Review</p>
          <h2 id="privacy-review-title" className="onb-privacy-review-title">Ready to finish</h2>
          <p className="onb-privacy-review-description">
            Your profile will use the choices below. You can revise them in Settings at any time.
          </p>
        </div>
        <dl className="onb-privacy-review-list">
          {summaryItems.map((item) => (
            <div key={item.label} className="onb-privacy-review-item">
              <dt className="nb-onb-review-k">
                {item.done === false ? <span className="nb-onb-review-box" aria-hidden="true" /> : <PixelIcon name="check" className="nb-onb-review-tick" />}
                {item.label}
              </dt>
              <dd>
                <span>{item.value}</span>
                {item.onEdit ? (
                  <button type="button" className="onb-review-edit onb-focusable" onClick={item.onEdit}>
                    Edit<span className="sr-only"> {item.label}</span>
                  </button>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  )
}
