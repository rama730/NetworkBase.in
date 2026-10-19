import type { ApplicationLifecycleStatus } from '@/lib/applications/status';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function calculateCooldown(updatedAt: Date, nowMs: number = Date.now()): { canApply: boolean; waitTime?: string } {
    const elapsed = nowMs - new Date(updatedAt).getTime();

    if (elapsed >= COOLDOWN_MS) {
        return { canApply: true };
    }

    const remaining = COOLDOWN_MS - elapsed;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    return { canApply: false, waitTime: `${hours}h ${minutes}m` };
}

/**
 * The applicant's text, kept as written: trimmed, line endings unified, and runs of blank lines
 * collapsed. Length is validated by the input schema, never silently truncated here.
 */
export function normalizeApplicationMessageText(raw: string) {
    return (raw || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function resolveLifecycleStatus(
    status: 'accepted' | 'rejected' | 'pending' | 'withdrawn' | 'proposed',
    decisionReason?: string | null,
): ApplicationLifecycleStatus {
    if (status === 'pending') return 'pending';
    if (status === 'proposed') return 'proposed';
    if (status === 'withdrawn') return 'withdrawn';
    if (status === 'accepted') return 'accepted';
    if (decisionReason === 'withdrawn_by_applicant') return 'withdrawn';
    if (decisionReason === 'role_filled') return 'role_filled';
    return 'rejected';
}
