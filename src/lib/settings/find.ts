// "Find a setting" (settings mix): every word must match the title, the section or the extra words; titles that start
// with the words come first.

export type FindEntry = { id: string; section: string; title: string; keywords: string };

export function searchSettings(entries: FindEntry[], query: string, limit = 8): FindEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: Array<{ entry: FindEntry; score: number; index: number }> = [];
  entries.forEach((entry, index) => {
    const title = entry.title.toLowerCase();
    const all = `${title} ${entry.section.toLowerCase()} ${entry.keywords.toLowerCase()}`;
    if (!words.every((word) => all.includes(word))) return;
    const phrase = words.join(" ");
    const score = title.startsWith(phrase) ? 0 : title.includes(phrase) ? 1 : words.every((word) => title.includes(word)) ? 2 : 3;
    scored.push({ entry, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit).map((item) => item.entry);
}

/** Words people type that aren't in a setting's name. */
export const FIND_EXTRAS: Record<string, string> = {
  "settings-account-email": "verify address mail",
  "settings-account-profile": "name username picture photo avatar handle",
  "settings-account-device": "cache storage sign out log out logout",
  "settings-security-signin": "login sign in methods",
  "settings-security-password": "change reset",
  "settings-security-twostep": "2fa mfa authenticator two factor otp code",
  "settings-security-codes": "backup recovery 2fa",
  "settings-security-google": "oauth link",
  "settings-security-github": "oauth link",
  "settings-security-sessions": "devices sessions sign out other log out",
  "settings-security-activity": "log history sign-ins audit",
  "settings-privacy-reach": "visibility private public messages dm requests connections",
  "settings-privacy-activity": "online presence active status last seen",
  "settings-privacy-blocked": "block unblock",
  "settings-privacy-muted": "mute unmute",
  "settings-notifications-types": "email alerts mentions tasks",
  "settings-notifications-pause": "pause snooze quiet hours do not disturb dnd",
  "settings-notifications-delivery": "email push browser test",
  "settings-appearance-theme": "dark light mode system",
  "settings-appearance-accent": "color colour",
  "settings-appearance-density": "compact comfortable spacing density",
  "settings-appearance-motion": "animation reduce motion",
  "settings-integrations-tokens": "api token pat personal access key",
  "settings-integrations-cli": "terminal cli agents mcp editor vscode claude",
  "settings-integrations-github": "repository repo commit",
  "settings-privacy-policies-export": "download export data gdpr",
  "settings-privacy-policies-cookies": "cookies consent",
  "settings-delete-account": "delete remove close account",
};
