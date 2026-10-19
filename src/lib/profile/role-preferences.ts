export const ROLE_PREFERENCE_OPTIONS = [
  { value: 'Full-time roles', label: 'Full-time' },
  { value: 'Part-time roles', label: 'Part-time' },
  { value: 'Contract roles', label: 'Contract' },
  { value: 'Freelance projects', label: 'Freelance' },
  { value: 'Internships', label: 'Internships' },
  { value: 'Co-founder opportunities', label: 'Co-founder' },
  { value: 'Advisory roles', label: 'Advisory' },
  { value: 'Consulting projects', label: 'Consulting' },
  { value: 'Fractional leadership', label: 'Fractional' },
  { value: 'Board member roles', label: 'Board member' },
  { value: 'Volunteer / Pro bono', label: 'Volunteer' },
  { value: 'Temporary / Seasonal', label: 'Temporary' },
] as const

export type RolePreferenceValue = (typeof ROLE_PREFERENCE_OPTIONS)[number]['value']

export const DESIGNATED_CATEGORIES = [
  'Engineering',
  'Design',
  'Product',
  'Growth',
  'AI & Machine Learning',
  'Data & Analytics',
  'Operations',
  'Marketing',
  'Sales & Business Dev',
  'Community & DevRel',
  'Security & DevOps',
  'Content & Writing',
  'Finance & Legal',
  'People & HR',
  'Hardware & IoT',
  'Web3 & Blockchain',
  'Quality Assurance',
] as const

export type DesignatedCategory = (typeof DESIGNATED_CATEGORIES)[number]

export const EXPERIENCE_LEVEL_OPTIONS = [
  { value: 'student', label: 'Student' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'founder', label: 'Founder' },
] as const

export const WEEKLY_CAPACITY_OPTIONS = [
  { value: 'lt_5', label: 'Less than 5 hours per week', compactLabel: '<5 hrs/week' },
  { value: 'h_5_10', label: '5–10 hours per week', compactLabel: '5–10 hrs/week' },
  { value: 'h_10_20', label: '10–20 hours per week', compactLabel: '10–20 hrs/week' },
  { value: 'h_20_40', label: '20–40 hours per week', compactLabel: '20–40 hrs/week' },
  { value: 'h_40_plus', label: '40+ hours per week', compactLabel: '40+ hrs/week' },
] as const

const roleAliases = new Map<string, RolePreferenceValue>([
  ['full_time', 'Full-time roles'],
  ['full-time', 'Full-time roles'],
  ['full time', 'Full-time roles'],
  ['full-time roles', 'Full-time roles'],
  ['part_time', 'Part-time roles'],
  ['part-time', 'Part-time roles'],
  ['part time', 'Part-time roles'],
  ['part-time roles', 'Part-time roles'],
  ['contract', 'Contract roles'],
  ['contracts', 'Contract roles'],
  ['contract role', 'Contract roles'],
  ['contract roles', 'Contract roles'],
  ['freelance', 'Freelance projects'],
  ['freelance work', 'Freelance projects'],
  ['freelance projects', 'Freelance projects'],
  ['internship', 'Internships'],
  ['internships', 'Internships'],
  ['cofounder', 'Co-founder opportunities'],
  ['co-founder', 'Co-founder opportunities'],
  ['co-founder opportunities', 'Co-founder opportunities'],
  ['advisor', 'Advisory roles'],
  ['advisors', 'Advisory roles'],
  ['advisory', 'Advisory roles'],
  ['advisory roles', 'Advisory roles'],
  ['consultant', 'Consulting projects'],
  ['consultants', 'Consulting projects'],
  ['consulting', 'Consulting projects'],
  ['consulting projects', 'Consulting projects'],
  ['fractional', 'Fractional leadership'],
  ['fractional leadership', 'Fractional leadership'],
  ['board', 'Board member roles'],
  ['board member', 'Board member roles'],
  ['board member roles', 'Board member roles'],
  ['volunteer', 'Volunteer / Pro bono'],
  ['volunteering', 'Volunteer / Pro bono'],
  ['volunteer work', 'Volunteer / Pro bono'],
  ['volunteer / pro bono', 'Volunteer / Pro bono'],
  ['pro bono', 'Volunteer / Pro bono'],
  ['pro-bono', 'Volunteer / Pro bono'],
  ['temporary', 'Temporary / Seasonal'],
  ['seasonal', 'Temporary / Seasonal'],
  ['temporary / seasonal', 'Temporary / Seasonal'],
])

const canonicalRoleOrder = new Map<RolePreferenceValue, number>(
  ROLE_PREFERENCE_OPTIONS.map((option, index) => [option.value, index]),
)

export function canonicalRolePreference(value: unknown): RolePreferenceValue | null {
  if (typeof value !== 'string') return null
  return roleAliases.get(value.trim().toLowerCase()) ?? null
}

export function getRolePreferences(values: unknown): RolePreferenceValue[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<RolePreferenceValue>()
  for (const value of values) {
    const canonical = canonicalRolePreference(value)
    if (canonical) seen.add(canonical)
  }
  return [...seen].sort(
    (left, right) => (canonicalRoleOrder.get(left) ?? 99) - (canonicalRoleOrder.get(right) ?? 99),
  )
}

/**
 * Replaces role-like values while retaining legacy collaboration interests.
 * This lets the role UI migrate old data without erasing unrelated preferences.
 */
export function replaceRolePreferences(
  existingValues: unknown,
  nextRoles: readonly string[],
): string[] {
  const legacyValues = Array.isArray(existingValues)
    ? existingValues.filter((value): value is string => (
        typeof value === 'string' && value.trim().length > 0 && !canonicalRolePreference(value)
      ))
    : []
  return [...legacyValues, ...getRolePreferences(nextRoles)]
}

export function rolePreferenceLabel(value: unknown): string | null {
  const canonical = canonicalRolePreference(value)
  if (!canonical) return null
  return ROLE_PREFERENCE_OPTIONS.find((option) => option.value === canonical)?.label ?? canonical
}

export function experienceLevelLabel(value: unknown): string | null {
  return EXPERIENCE_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? null
}

export function weeklyCapacityLabel(value: unknown): string | null {
  return WEEKLY_CAPACITY_OPTIONS.find((option) => option.value === value)?.label ?? null
}

