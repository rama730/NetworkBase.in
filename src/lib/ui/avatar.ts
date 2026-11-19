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

/** FNV-1a over the trimmed, lower-cased key: similar names and IDs spread across a palette, the same key always lands in the same place. */
export function identityHash(identityKey: string): number {
    let hash = 2166136261;
    for (const character of identityKey.trim().toLowerCase()) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/** Emails still draw initials on these tones (mail apps strip SVG). */
export function getPersonAvatarTone(identityKey: string): PersonAvatarTone {
    return PERSON_AVATAR_TONES[identityHash(identityKey) % PERSON_AVATAR_TONES.length] ?? PERSON_AVATAR_TONES[0];
}

/** The pixel person: the marketing band's figure (7 wide, 8 tall), used as everyone's avatar until they add a photo. */
export const PIXEL_PERSON = ['..###..', '..###..', '..###..', '.......', '.#####.', '#######', '#######', '##...##'] as const;

const PIXEL_DARK = ['#D14E24', '#2563C9', '#2F6B4F'] as const;
const PIXEL_PALE = ['#EDBF85', '#A7C3F0', '#99CEAD'] as const;

/**
 * [figure, tile] colour pairs from the six brand colours: dark on pale, pale on dark, dark on paper, pale on ink (24).
 * A person keeps one pair for life, picked from their id, so they look the same on every page and device.
 */
export const PIXEL_PERSON_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ...PIXEL_DARK.flatMap((figure) => PIXEL_PALE.map((tile) => [figure, tile] as const)),
    ...PIXEL_PALE.flatMap((figure) => PIXEL_DARK.map((tile) => [figure, tile] as const)),
    ...PIXEL_DARK.map((figure) => [figure, '#F3F0EA'] as const),
    ...PIXEL_PALE.map((figure) => [figure, '#212A30'] as const),
];

/**
 * Default avatars for places, on the pixel person's own grid (7 wide, 8 tall, standing on the bottom edge), so a person,
 * the building they belong to and their desk read as one pixel world. Organization: a building with windows and a
 * door. Workspace: a desk with a screen. Child workspace (inside an organization): the same desk under its org's roof,
 * drawn in the org's colours so an org and its workspaces look like one family.
 */
export const PIXEL_PLACES = {
    organization: ['...#...', '..###..', '.#####.', '#######', '#.#.#.#', '#######', '##.#.##', '##.#.##'],
    workspace: ['.#####.', '.#...#.', '.#...#.', '.#####.', '...#...', '#######', '.#...#.', '.#...#.'],
    child: ['...#...', '..#.#..', '.#...#.', '.#####.', '.#...#.', '#######', '.#...#.', '.#...#.'],
} as const;
export type PixelPlaceKind = keyof typeof PIXEL_PLACES;

/** The ink tile: in dark mode it gets a 1px inner edge so it doesn't sink into dark surfaces. */
export const PIXEL_INK_TILE = '#212A30';

export function pixelPersonPair(identityKey: string): readonly [string, string] {
    return PIXEL_PERSON_PAIRS[identityHash(identityKey) % PIXEL_PERSON_PAIRS.length]!;
}

/**
 * Where the figure's cells go in a square tile of `size` px: whole-pixel cells (size / 9, rounded down), the figure
 * centred and standing on the bottom edge like a bust. Without a size, a 9-cell box that scales.
 */
export function pixelPersonLayout(size?: number) {
    const box = size && size >= 9 ? Math.round(size) : 9;
    const cell = Math.max(1, Math.floor(box / 9));
    return { box, cell, left: Math.floor((box - 7 * cell) / 2), top: box - 8 * cell };
}
