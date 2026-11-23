"use client";

import { useEffect, useState } from "react";
import { useAppearance, useTheme } from "@/components/providers/theme-provider";
import { PixelIcon } from "@/components/auth/pixel";
import { Button } from "@/components/ui/button";
import { ChoiceCells } from "@/components/settings/mix/parts";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { ACCENT_PALETTES, DENSITY_LABELS } from "@/lib/theme/appearance-runtime";
import { DEFAULT_APPEARANCE_SNAPSHOT, type AccentColor, type Density, type ThemeMode } from "@/lib/theme/appearance";
import { clockTime } from "@/lib/settings/format";

const THEMES: Array<{ value: ThemeMode; label: string; line: string }> = [
  { value: "light", label: "Light", line: "Paper" },
  { value: "dark", label: "Dark", line: "Ink" },
  { value: "system", label: "System", line: "Follows this device" },
];
const ACCENTS = Object.values(ACCENT_PALETTES).map((accent) => ({ value: accent.id, label: accent.label }));
const DENSITIES = (Object.entries(DENSITY_LABELS) as Array<[Density, { label: string; description: string }]>).map(([value, meta]) => ({ value, label: meta.label, line: meta.description }));
const GAP: Record<Density, number> = { compact: 2, default: 4, comfortable: 6 };

/** A small picture of the app in that theme, so the choice is seen before it's made. */
function Shot({ theme }: { theme: ThemeMode }) {
  const light = { bg: "#FAF8F4", card: "#FFFFFF", line: "#DBD5C8", fg: "#141A1E" };
  const dark = { bg: "#0D1114", card: "#141A1E", line: "#2A343A", fg: "#FAF8F4" };
  const c = theme === "dark" ? dark : light;
  return (
    <span className="shot" aria-hidden="true" style={{ background: c.bg }}>
      {theme === "system" ? <i style={{ right: 0, top: 0, bottom: 0, width: "50%", background: dark.bg }} /> : null}
      <i style={{ left: 8, top: 8, width: "40%", height: 8, background: c.fg, opacity: 0.8 }} />
      <i style={{ left: 8, top: 22, right: 8, height: 30, border: `1px solid ${c.line}`, background: c.card }} />
      <i style={{ left: 14, top: 30, width: "30%", height: 4, background: c.fg, opacity: 0.45 }} />
      <i style={{ left: 14, top: 40, width: 20, height: 6, background: "var(--nbs-brand)" }} />
    </span>
  );
}

/** Appearance (settings mix v2): theme cards, named square swatches, spacing cells; saved state and Reset on the label. */
export default function AppearanceSettings() {
  const { theme, resolvedTheme, setThemeWithTransition } = useTheme();
  const { accentColor, setAccentColor, density, setDensity, reduceMotion, setReduceMotion, welcomeAnimation, setWelcomeAnimation, systemReduceMotion, syncState, lastSyncedAt, resetAppearance, retrySync } = useAppearance();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <SettingsSectionsSkeleton count={3} />;

  const isDefault = theme === DEFAULT_APPEARANCE_SNAPSHOT.theme && accentColor === DEFAULT_APPEARANCE_SNAPSHOT.accentColor && density === DEFAULT_APPEARANCE_SNAPSHOT.density && reduceMotion === DEFAULT_APPEARANCE_SNAPSHOT.reduceMotion && welcomeAnimation === DEFAULT_APPEARANCE_SNAPSHOT.welcomeAnimation;
  const failed = syncState === "save_failed";
  const sync = syncState === "saving" ? "Saving…"
    : failed ? "Not saved to your account"
    : syncState === "queued" ? "Saved here · syncing"
    : syncState === "saved" ? `Saved${lastSyncedAt ? ` · ${clockTime(new Date(lastSyncedAt).toISOString())}` : ""}`
    : "Saved on this device";

  return <>
    <SettingsSectionCard id="settings-appearance-theme" title="Theme" flush findKeys="dark light mode"
      right={<>
        <span role="status" className={failed ? "nb-retry" : "nbs-meta inline-flex items-center gap-1.5"}>
          {failed ? <><b>Not saved</b><span className="sr-only">: {sync}</span><button type="button" onClick={retrySync}>Try again</button></> : <>{syncState === "saved" ? <PixelIcon name="check" /> : null}{sync}</>}
        </span>
        {syncState === "queued" ? <Button type="button" variant="ghost" size="sm" onClick={retrySync}>Sync now</Button> : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => void resetAppearance()} disabled={syncState === "saving" || isDefault}>Reset</Button>
      </>}>
      <div className="nbs-pad">
        <ChoiceCells<ThemeMode> label="Theme" value={theme as ThemeMode} options={THEMES} onChange={(next) => void setThemeWithTransition(next)} className="nbs-themes" testIdPrefix="appearance-theme"
          render={(option) => {
            const meta = THEMES.find((item) => item.value === option.value)!;
            return <><Shot theme={option.value} /><span className="lbl">{option.label}<small>{option.value === "system" && theme === "system" ? `Now ${resolvedTheme}` : meta.line}</small></span></>;
          }} />
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-appearance-accent" title="Accent" flush findKeys="color colour">
      <div className="nbs-pad">
        <ChoiceCells<AccentColor> label="Accent" value={accentColor} options={ACCENTS} onChange={setAccentColor} className="nbs-swatches" testIdPrefix="appearance-accent"
          render={(option, selected) => {
            const palette = ACCENT_PALETTES[option.value];
            return <><i aria-hidden="true" style={{ "--swatch": palette.solid, "--swatch-dark": palette.solidDark } as React.CSSProperties}>{selected ? <PixelIcon name="check" /> : null}</i>{option.label}</>;
          }} />
      </div>
      <p className="nbs-foot">Used for actions, the chosen tab and focus. Each color has its own dark version.</p>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-appearance-density" title="Spacing" flush findKeys="density compact comfortable">
      <div className="nbs-pad">
        <ChoiceCells<Density> label="Spacing" value={density} options={DENSITIES} onChange={setDensity} className="nbs-dense" marker testIdPrefix="appearance-density"
          render={(option) => <>
            <span className="lines" aria-hidden="true" style={{ gap: GAP[option.value] }}><i /><i /><i /></span>
            <b>{option.label}</b><span>{DENSITIES.find((item) => item.value === option.value)!.line}</span>
          </>} />
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-appearance-motion" title="Motion" flush findKeys="animation">
      <SettingsRows>
        <SettingsRow
          title="Reduce motion"
          description={systemReduceMotion && !reduceMotion ? "Your device already asks for less motion, so animation is reduced. Turn this on to keep it that way everywhere." : "Less animation, hover movement and smooth scrolling everywhere."}
          right={<SettingsSwitch checked={reduceMotion} onCheckedChange={setReduceMotion} data-testid="appearance-reduce-motion-toggle" aria-label="Reduce motion" />}
        />
        <SettingsRow
          title="Welcome animation"
          description="A short welcome when you sign in."
          right={<SettingsSwitch checked={welcomeAnimation} onCheckedChange={setWelcomeAnimation} data-testid="appearance-welcome-animation-toggle" aria-label="Welcome animation" />}
        />
      </SettingsRows>
    </SettingsSectionCard>
  </>;
}
