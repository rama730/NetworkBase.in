import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8')

describe('onboarding flow enhancements', () => {
  it('uses native radio controls and an accurate public-profile disclosure', () => {
    const privacy = source('steps/Step4Privacy.tsx')
    assert.match(privacy, /type="radio"/)
    assert.match(privacy, /name=\{id\}/)
    assert.match(privacy, /Public profiles can be viewed without an account and may be indexed or cached/)
    assert.match(privacy, /editLabel/)
  })

  it('exposes step-two sections as keyboard-operable tabs and panels', () => {
    const nav = source('SectionNav.tsx')
    const details = source('steps/Step2Details.tsx')
    assert.match(nav, /role="tablist"/)
    assert.match(nav, /role="tab"/)
    assert.match(nav, /ArrowRight/)
    assert.match(nav, /ArrowLeft/)
    assert.match(details, /role="tabpanel"/)
    assert.match(details, /optionalUrlError/)
    assert.match(details, /locationError/)
  })

  it('gives identity, skills, and uploads clear validation feedback', () => {
    const identity = source('steps/Step1Identity.tsx')
    const username = source('UsernameInput.tsx')
    const skills = source('steps/Step3Skills.tsx')
    assert.match(identity, /full-name-hint/)
    assert.match(identity, /avatarStatus/)
    assert.match(username, /username-rules/)
    assert.match(skills, /Add at least one skill to continue/)
    assert.match(skills, /25 skills selected/)
  })

  it('communicates recoverable save state and final action wording', () => {
    const footer = source('StepFooter.tsx')
    const page = source('../../app/(site)/(onboarding)/onboarding/page.tsx')
    assert.match(footer, /Finish profile/)
    assert.match(footer, /disabledReason/)
    assert.match(footer, /saveStatus/)
    assert.match(page, /Changes are saved in this browser/)
    assert.match(page, /Your entries remain available in this browser/)
  })

  it('keeps the review legible before desktop width', () => {
    const tokens = source('../../styles/onboarding-tokens.css')
    const layout = source('OnboardingLayout.tsx')
    assert.match(tokens, /@media \(min-width: 768px\)/)
    assert.match(layout, /lg:grid/)
    assert.match(layout, /lg:block/)
  })

  it('uses semantic tokens for controls, errors, and focused privacy choices', () => {
    const tokens = source('../../styles/onboarding-tokens.css')
    assert.match(tokens, /--onb-control-bg/)
    assert.match(tokens, /--onb-feedback-error-bg/)
    assert.match(tokens, /onb-privacy-choice-input:focus-visible/)
    assert.match(tokens, /prefers-reduced-motion/)
  })
})
