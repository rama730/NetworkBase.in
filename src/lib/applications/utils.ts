import type { ApplicationLifecycleStatus } from '@/lib/applications/status';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** How long after submitting the applicant can still edit the application. */
export const APPLICATION_EDIT_WINDOW_MS = 10 * 60 * 1000;

/** How long after a decline a reviewer can reopen it. */
export const APPLICATION_REOPEN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether a reviewer can reopen this application now, and for how many more minutes. Only a decline can be
 * reopened, only inside the window, and not when it was closed because the role filled or the role is gone.
 */
export function reopenState(
    application: { status: string; decision_at: string | Date | null; decision_reason_code: string | null; role_removed: boolean },
    nowMs: number = Date.now(),
): { canReopen: boolean; minutesLeft: number } {
    if (application.status !== 'rejected' || !application.decision_at || application.role_removed || application.decision_reason_code === 'role_filled') {
        return { canReopen: false, minutesLeft: 0 };
    }
    const left = new Date(application.decision_at).getTime() + APPLICATION_REOPEN_WINDOW_MS - nowMs;
    return left > 0 ? { canReopen: true, minutesLeft: Math.max(1, Math.ceil(left / 60_000)) } : { canReopen: false, minutesLeft: 0 };
}

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

/** A link from an application's details, only if it is a plain http(s) URL: anything else is never put in an href. */
export function safeHttpUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
        return null;
    }
}
