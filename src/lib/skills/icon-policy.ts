import type { SkillSummary } from './types'

/** Generic glyphs and monograms are metadata fallbacks, not skill artwork. */
export function hasSkillIcon(skill: Pick<SkillSummary, 'iconSource' | 'iconKey'>): boolean {
    return Boolean(skill.iconKey) && skill.iconSource !== 'lucide' && skill.iconSource !== 'monogram'
}
