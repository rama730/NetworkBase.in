/** The sections of the Settings document, in order. `delete-account` is a section but not a tab of its own. */
export const SETTINGS_SECTIONS = [
  "account",
  "security",
  "privacy",
  "notifications",
  "appearance",
  "integrations",
  "privacy-policies",
  "delete-account",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const settingsSectionId = (section: SettingsSection) => `settings-${section}`;

/** The address that points at a section. The page is one document, so a section is a #hash, not a route. */
export const settingsSectionHref = (section: SettingsSection) => `/settings#${settingsSectionId(section)}`;

/**
 * The section an element id belongs to: `settings-security` and `settings-security-sessions` are both Security.
 * The longest match wins, so `settings-privacy-policies` is not read as Privacy.
 */
export function sectionFromElementId(id: string | null | undefined): SettingsSection | null {
  if (!id) return null;
  let best: SettingsSection | null = null;
  for (const section of SETTINGS_SECTIONS) {
    const base = settingsSectionId(section);
    if ((id === base || id.startsWith(`${base}-`)) && (!best || section.length > best.length)) best = section;
  }
  return best;
}

/**
 * Where an address wants to land: a #hash on any element inside a section wins; otherwise the older `?tab=`
 * form (still used by emails, search results and bookmarks); otherwise the top (Account).
 */
/** Anchors the settings mix renamed or merged (2026-11-23). Old links from emails, search and bookmarks still land. */
export const SETTINGS_ANCHOR_ALIASES: Record<string, string> = {
  "settings-security-authenticator": "settings-security-twostep",
  "settings-integrations-connections": "settings-security-signin",
  "settings-security-sign-ins": "settings-security-activity",
  "settings-integrations-pat": "settings-integrations-tokens",
  "settings-integrations-token": "settings-integrations-tokens",
};

export function resolveSettingsTarget(input: { hash?: string | null; tab?: string | null }): { elementId: string; section: SettingsSection } {
  const raw = (input.hash ?? "").replace(/^#/, "");
  const hash = SETTINGS_ANCHOR_ALIASES[raw] ?? raw;
  const fromHash = sectionFromElementId(hash);
  if (fromHash) return { elementId: hash, section: fromHash };
  const tab = (SETTINGS_SECTIONS as readonly string[]).includes(input.tab ?? "") ? (input.tab as SettingsSection) : "account";
  return { elementId: settingsSectionId(tab), section: tab };
}
