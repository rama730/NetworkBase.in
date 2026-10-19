"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useAppearance, useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { ACCENT_PALETTES, DENSITY_LABELS, getAccentSwatchBackground } from "@/lib/theme/appearance-runtime";
import { DEFAULT_APPEARANCE_SNAPSHOT } from "@/lib/theme/appearance";
import { cn } from "@/lib/utils";

const themeOptions = [
  { id: "light", label: "Light", description: "Always use the light interface.", icon: Sun },
  { id: "dark", label: "Dark", description: "Always use the dark interface.", icon: Moon },
  { id: "system", label: "System", description: "Follow this device's setting.", icon: Monitor },
] as const;

export default function AppearanceSettings({ embedded = false }: { embedded?: boolean }) {
  const { theme, resolvedTheme, setThemeWithTransition } = useTheme();
  const { accentColor, setAccentColor, density, setDensity, reduceMotion, setReduceMotion, syncState, lastSyncedAt, resetAppearance } = useAppearance();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={embedded ? "space-y-8" : "space-y-4 pb-10"}>{!embedded ? <SettingsPageHeader title="Appearance" description="Customize theme, color, density, and motion." /> : null}<SettingsSectionsSkeleton /></div>;
  }

  const isDefaultAppearance = theme === DEFAULT_APPEARANCE_SNAPSHOT.theme && accentColor === DEFAULT_APPEARANCE_SNAPSHOT.accentColor && density === DEFAULT_APPEARANCE_SNAPSHOT.density && reduceMotion === DEFAULT_APPEARANCE_SNAPSHOT.reduceMotion;
  const syncMessage = syncState === "saving" ? "Syncing to your account" : syncState === "save_failed" ? "Couldn’t sync account preference" : syncState === "saved" ? `Saved to your account${lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : "Saved on this device";

  return <div className={embedded ? "space-y-8" : "space-y-6 pb-10"}>
    {!embedded ? <SettingsPageHeader title="Appearance" description="Customize theme, color, density, and motion." /> : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className={cn("nb-compact text-muted-foreground", syncState === "save_failed" && "text-destructive")}>{syncMessage}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void resetAppearance()} disabled={syncState === "saving" || isDefaultAppearance}>
        <RotateCcw className="size-4" strokeWidth={1.75} />Reset to defaults
      </Button>
    </div>

    <SettingsSectionCard title="Theme and color" description="Choose the interface theme and shared action color.">
      <div>
        <h4 className="nb-ui-label text-foreground">Theme mode</h4>
        <p className="nb-compact mt-1 text-muted-foreground">Current effective theme: <span className="font-medium capitalize text-foreground">{resolvedTheme}</span>.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {themeOptions.map(({ id, label, description, icon: Icon }) => <button key={id} type="button" data-testid={`appearance-theme-${id}`} aria-pressed={theme === id} onClick={() => void setThemeWithTransition(id)} className={cn("flex min-h-16 items-center gap-3 rounded-md border border-border bg-background px-3 py-3 text-left transition-colors hover:bg-muted", theme === id && "border-primary bg-primary/5")}>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", theme === id && "bg-primary/10 text-primary")}><Icon className="size-4" strokeWidth={1.75} /></span>
            <span className="min-w-0"><span className="block nb-ui-label text-foreground">{label}</span><span className="block nb-compact mt-1 text-muted-foreground">{description}</span></span>
          </button>)}
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <h4 className="nb-ui-label text-foreground">Accent color</h4>
        <p className="nb-compact mt-1 text-muted-foreground">Used for actions, selected states, and focus indicators.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {Object.values(ACCENT_PALETTES).map((accent) => <button key={accent.id} type="button" onClick={() => setAccentColor(accent.id)} title={`${accent.label}: ${accent.description}`} aria-label={accent.label} aria-pressed={accentColor === accent.id} data-testid={`appearance-accent-${accent.id}`} className={cn("relative flex size-11 items-center justify-center rounded-full border border-border transition-transform hover:scale-105", accentColor === accent.id && "ring-2 ring-ring ring-offset-2 ring-offset-background")}>
            <span className="size-8 rounded-full" style={{ background: getAccentSwatchBackground(accent.id) }} />
          </button>)}
        </div>
        <p className="nb-meta mt-3 text-muted-foreground">Selected: <span className="font-medium text-foreground">{ACCENT_PALETTES[accentColor].label}</span></p>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard title="Layout and motion" description="Adjust information density and movement for comfort and accessibility.">
      <div>
        <h4 className="nb-ui-label text-foreground">Interface density</h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {Object.entries(DENSITY_LABELS).map(([densityId, densityMeta]) => <button key={densityId} type="button" onClick={() => setDensity(densityId as keyof typeof DENSITY_LABELS)} data-testid={`appearance-density-${densityId}`} aria-pressed={density === densityId} className={cn("min-h-16 rounded-md border border-border bg-background px-3 py-3 text-left transition-colors hover:bg-muted", density === densityId && "border-primary bg-primary/5")}>
            <span className="block nb-ui-label text-foreground">{densityMeta.label}</span><span className="block nb-compact mt-1 text-muted-foreground">{densityMeta.description}</span>
          </button>)}
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-2">
        <SettingsRow title="Reduce motion" description="Minimize animation, hover movement, and smooth scrolling throughout the interface." right={<SettingsSwitch showLabel checked={reduceMotion} onCheckedChange={setReduceMotion} data-testid="appearance-reduce-motion-toggle" aria-label="Reduce motion" />} />
      </div>
    </SettingsSectionCard>
  </div>;
}
