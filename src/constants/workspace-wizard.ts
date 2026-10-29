/**
 * Constants for the project creation wizard.
 * Pure optimization: Single source of truth for phases and labels.
 */

export const WIZARD_PHASES = [
    { id: 1, label: 'Start' },
    { id: 2, label: 'Info' },
    { id: 3, label: 'Team' },
    { id: 4, label: 'Settings' },
    { id: 5, label: 'Review' },
] as const;

export type WizardPhaseId = typeof WIZARD_PHASES[number]['id'];

/** Organizations keep the positions with their own words (report §34.1, decision 178). */
export const ORG_PHASE_LABELS: Record<WizardPhaseId, string> = { 1: 'Start', 2: 'Details', 3: 'People', 4: 'Setup', 5: 'Review' };

export const TOTAL_PHASES = WIZARD_PHASES.length;

