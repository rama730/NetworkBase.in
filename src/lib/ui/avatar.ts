import type { CSSProperties } from 'react';

/** Shared solid fallback treatment; the legacy name preserves the identity API. */
export function getAvatarGradient(_name: string): string {
    return 'nb-avatar-fallback';
}

/** Stable, soft person-card fallback tones, shared across People views. */
export const PERSON_AVATAR_TONES = ['amber', 'blue', 'mint', 'rose'] as const;

export type PersonAvatarTone = (typeof PERSON_AVATAR_TONES)[number];

/** Component aliases use the same semantic colors in light and dark themes. */
export const PERSON_AVATAR_TONE_STYLES: Record<PersonAvatarTone, CSSProperties> = {
    amber: { backgroundColor: 'var(--status-warning-soft)', color: 'var(--status-warning)' },
    blue: { backgroundColor: 'var(--status-info-soft)', color: 'var(--status-info)' },
    mint: { backgroundColor: 'var(--status-success-soft)', color: 'var(--status-success)' },
    rose: { backgroundColor: 'var(--status-danger-soft)', color: 'var(--status-danger)' },
};

export function getPersonAvatarTone(identityKey: string): PersonAvatarTone {
    // FNV-1a spreads similar names and IDs across the palette without relying on
    // array position, which could change when the People list is reordered.
    let hash = 2166136261;
    for (const character of identityKey.trim().toLowerCase()) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return PERSON_AVATAR_TONES[(hash >>> 0) % PERSON_AVATAR_TONES.length] ?? PERSON_AVATAR_TONES[0];
}
