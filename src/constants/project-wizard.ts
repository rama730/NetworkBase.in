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

export const TOTAL_PHASES = WIZARD_PHASES.length;

