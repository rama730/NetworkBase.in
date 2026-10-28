import { type AccentColor, type Density } from "@/lib/theme/appearance";

export type AccentPaletteMeta = {
    id: AccentColor;
    label: string;
    description: string;
    solid: string;
    /** The same action colour as it is applied on dark surfaces (see the data-accent rules in globals.css). */
    solidDark: string;
    selectedTint: string;
};

export const ACCENT_PALETTES: Record<AccentColor, AccentPaletteMeta> = {
    default: {
        id: "default",
        label: "Clay",
        description: "Warm clay, the default.",
        solid: "#C24720",
        solidDark: "#F3A17E",
        selectedTint: "#F3F0EA",
    },
    orchid: {
        id: "orchid",
        label: "Orchid",
        description: "Violet.",
        solid: "#77449B",
        solidDark: "#D3ADF0",
        selectedTint: "color-mix(in srgb, #77449B 7%, #FAF8F4)",
    },
    forest: {
        id: "forest",
        label: "Forest",
        description: "Emerald green.",
        solid: "#2F6B4F",
        solidDark: "#99CEAD",
        selectedTint: "color-mix(in srgb, #2F6B4F 7%, #FAF8F4)",
    },
    ember: {
        id: "ember",
        label: "Ember",
        description: "Warm amber.",
        solid: "#955B15",
        solidDark: "#EDBF85",
        selectedTint: "color-mix(in srgb, #955B15 7%, #FAF8F4)",
    },
    rose: {
        id: "rose",
        label: "Rose",
        description: "Rose.",
        solid: "#A33D59",
        solidDark: "#EEA7BB",
        selectedTint: "color-mix(in srgb, #A33D59 7%, #FAF8F4)",
    },
    lagoon: {
        id: "lagoon",
        label: "Lagoon",
        description: "Teal.",
        solid: "#226974",
        solidDark: "#9ED2D6",
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
