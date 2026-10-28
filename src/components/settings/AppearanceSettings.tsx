"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useAppearance, useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { SettingsRadioGroup } from "@/components/settings/ui/SettingsRadioGroup";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { ACCENT_PALETTES, DENSITY_LABELS } from "@/lib/theme/appearance-runtime";
import { DEFAULT_APPEARANCE_SNAPSHOT, type AccentColor, type Density, type ThemeMode } from "@/lib/theme/appearance";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light" as const, label: "Light", description: "Always use the light interface.", icon: Sun },
  { value: "dark" as const, label: "Dark", description: "Always use the dark interface.", icon: Moon },
  { value: "system" as const, label: "System", description: "Follow this device's setting.", icon: Monitor },
];
const ACCENT_OPTIONS = Object.values(ACCENT_PALETTES).map((accent) => ({ value: accent.id, label: accent.label, description: accent.description }));
const DENSITY_OPTIONS = (Object.entries(DENSITY_LABELS) as Array<[Density, { label: string; description: string }]>).map(([value, meta]) => ({ value, label: meta.label, description: meta.description }));

/** A little list in each density's own spacing, so the choice can be seen before it is made. */
const DENSITY_PREVIEW_GAP: Record<Density, string> = { compact: "gap-0.5", default: "gap-1", comfortable: "gap-1.5" };

export default function AppearanceSettings() {
  const { theme, resolvedTheme, setThemeWithTransition } = useTheme();
  const { accentColor, setAccentColor, density, setDensity, reduceMotion, setReduceMotion, systemReduceMotion, syncState, lastSyncedAt, resetAppearance, retrySync } = useAppearance();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="space-y-8"><SettingsSectionsSkeleton /></div>;
  }

  const isDefaultAppearance = theme === DEFAULT_APPEARANCE_SNAPSHOT.theme && accentColor === DEFAULT_APPEARANCE_SNAPSHOT.accentColor && density === DEFAULT_APPEARANCE_SNAPSHOT.density && reduceMotion === DEFAULT_APPEARANCE_SNAPSHOT.reduceMotion;
  const syncMessage = syncState === "saving" ? "Syncing to your account…"
    : syncState === "save_failed" ? "Couldn’t sync to your account. It is saved on this device."
    : syncState === "queued" ? "Saved on this device. It will sync to your account shortly."
    : syncState === "saved" ? `Saved to your account${lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`
    : "Saved on this device";
  const canRetry = syncState === "save_failed" || syncState === "queued";

  return <div className="space-y-8">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p role="status" className={cn("flex flex-wrap items-center gap-2 nb-compact text-muted-foreground", syncState === "save_failed" && "text-destructive")}>
        {syncMessage}
        {canRetry ? <Button type="button" variant="outline" size="sm" onClick={retrySync} className="pointer-coarse:h-11">Retry</Button> : null}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => void resetAppearance()} disabled={syncState === "saving" || isDefaultAppearance} className="pointer-coarse:h-11">
        <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />Reset to defaults
      </Button>
    </div>

    <SettingsSectionCard title="Theme and color" description="Choose the interface theme and shared action color.">
      <SettingsRadioGroup<ThemeMode>
        id="settings-appearance-theme"
        label="Theme"
        description={theme === "system" ? `Following this device: ${resolvedTheme}.` : undefined}
        value={theme}
        onValueChange={(next) => void setThemeWithTransition(next)}
        options={THEME_OPTIONS}
        testIdPrefix="appearance-theme"
        optionsClassName="sm:grid-cols-3"
      />

      <div className="mt-6 border-t border-border pt-6">
        <SettingsRadioGroup<AccentColor>
          id="settings-appearance-accent"
          label="Accent color"
          description="Used for actions, selected states, and focus indicators."
          value={accentColor}
          onValueChange={setAccentColor}
          options={ACCENT_OPTIONS}
          testIdPrefix="appearance-accent"
          optionsClassName="flex flex-wrap gap-3"
          renderOption={(option, { selected }) => {
            const palette = ACCENT_PALETTES[option.value];
            return <span title={`${option.label}: ${option.description}`} className={cn("flex size-11 items-center justify-center rounded-full border-2 border-border transition-colors hover:border-foreground/40", selected && "border-foreground")}>
              <span className="sr-only">{option.label}</span>
              {/* Light and dark values of the colour that is applied, so the swatch matches what you get. */}
              <span aria-hidden="true" className="size-7 rounded-full bg-[var(--swatch)] dark:bg-[var(--swatch-dark)]" style={{ "--swatch": palette.solid, "--swatch-dark": palette.solidDark } as React.CSSProperties} />
            </span>;
          }}
        />
        <p className="nb-meta mt-3 text-muted-foreground">Selected: <span className="font-medium text-foreground">{ACCENT_PALETTES[accentColor].label}</span></p>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard title="Layout and motion" description="Adjust information density and movement for comfort and accessibility.">
      <SettingsRadioGroup<Density>
        id="settings-appearance-density"
        label="Interface density"
        value={density}
        onValueChange={setDensity}
        options={DENSITY_OPTIONS}
        testIdPrefix="appearance-density"
        optionsClassName="sm:grid-cols-3"
        renderOption={(option, { selected }) => <span className={cn("flex min-h-16 w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-3 hover:bg-muted", selected && "border-primary bg-primary/5")}>
          <span aria-hidden="true" className={cn("flex w-6 shrink-0 flex-col", DENSITY_PREVIEW_GAP[option.value])}>
            {[0, 1, 2].map((row) => <span key={row} className={cn("h-1 rounded-sm bg-muted-foreground/40", selected && "bg-primary/60")} />)}
          </span>
          <span className="min-w-0"><span className="block nb-ui-label text-foreground">{option.label}</span><span className="block nb-compact mt-1 text-muted-foreground">{option.description}</span></span>
        </span>}
      />
      <div id="settings-appearance-motion" className="mt-4 scroll-mt-6 border-t border-border pt-2">
        <SettingsRow
          title="Reduce motion"
          description={systemReduceMotion && !reduceMotion ? "Your device already asks for less motion, so animation is reduced. Turn this on to keep it that way everywhere." : "Minimize animation, hover movement, and smooth scrolling throughout the interface."}
          right={<SettingsSwitch showLabel checked={reduceMotion} onCheckedChange={setReduceMotion} data-testid="appearance-reduce-motion-toggle" aria-label="Reduce motion" />}
        />
      </div>
    </SettingsSectionCard>
  </div>;
}
