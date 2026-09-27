import { type AccentColor, type Density } from "@/lib/theme/appearance";

export type AccentPaletteMeta = {
    id: AccentColor;
    label: string;
    description: string;
    solid: string;
    selectedTint: string;
};

export const ACCENT_PALETTES: Record<AccentColor, AccentPaletteMeta> = {
    default: {
        id: "default",
        label: "Clay",
        description: "Warm clay actions on paper surfaces.",
        solid: "#C24720",
        selectedTint: "#F3F0EA",
    },
    orchid: {
        id: "orchid",
        label: "Orchid",
        description: "Solid violet actions with a soft lavender selected surface.",
        solid: "#77449B",
        selectedTint: "color-mix(in srgb, #77449B 7%, #FAF8F4)",
    },
    forest: {
        id: "forest",
        label: "Forest",
        description: "Solid emerald actions with a pale mint selected surface.",
        solid: "#2F6B4F",
        selectedTint: "color-mix(in srgb, #2F6B4F 7%, #FAF8F4)",
    },
    ember: {
        id: "ember",
        label: "Ember",
        description: "Solid orange actions with a soft amber selected surface.",
        solid: "#955B15",
        selectedTint: "color-mix(in srgb, #955B15 7%, #FAF8F4)",
    },
    rose: {
        id: "rose",
        label: "Rose",
        description: "Solid rose actions with a soft blush selected surface.",
        solid: "#A33D59",
        selectedTint: "color-mix(in srgb, #A33D59 7%, #FAF8F4)",
    },
    lagoon: {
        id: "lagoon",
        label: "Lagoon",
        description: "Solid teal actions with a pale cyan selected surface.",
        solid: "#226974",
        selectedTint: "color-mix(in srgb, #226974 7%, #FAF8F4)",
    },
};

export const DENSITY_LABELS: Record<Density, { label: string; description: string }> = {
    compact: {
        label: "Compact",
        description: "Tighter spacing for dense navigation, lists, and panels.",
    },
    default: {
        label: "Default",
        description: "Balanced spacing across forms, panels, and navigation.",
    },
    comfortable: {
        label: "Comfortable",
        description: "More breathing room in lists, cards, and page sections.",
    },
};

export function getAccentSwatchBackground(accentColor: AccentColor): string {
    const palette = ACCENT_PALETTES[accentColor];
    return palette.solid;
}
