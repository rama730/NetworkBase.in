const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type WorkspaceLastUpdate = { projectId: string; at: string; byName: string | null };

/** 25m ago, 2h ago, 3d ago, then 28 Oct, with the year once it isn't this year. */
export function formatLastUpdateTime(at: string | Date, now: number = Date.now()) {
  const date = new Date(at);
  const elapsed = now - date.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

export function lastUpdateLine(update: Pick<WorkspaceLastUpdate, "at" | "byName">, now?: number) {
  const time = formatLastUpdateTime(update.at, now);
  return update.byName ? `Updated by ${update.byName} · ${time}` : `Updated ${time}`;
}

/** Non-members see the name only on a public profile; a block hides it either way. */
export function lastUpdateName(
  person: { fullName?: string | null; username?: string | null; visibility?: string | null; blocked?: boolean | null },
  viewerIsMember: boolean,
) {
  if (person.blocked) return null;
  if (!viewerIsMember && person.visibility !== "public") return null;
  return person.fullName?.trim() || person.username?.trim() || null;
}
