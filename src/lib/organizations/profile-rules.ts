// Org cards, Discover and profile rules (report §24), pure so server, cards and profile agree.

const DAY = 86_400_000;

/** Decision 160: a new public org reaches Discover after 3+ members and 7+ days, or once verified. */
export function orgDiscoverable(input: { members: number; createdAt: Date; verifiedAt: Date | null; now?: Date }) {
  if (input.verifiedAt) return true;
  const now = input.now ?? new Date();
  return input.members >= 3 && now.getTime() - input.createdAt.getTime() >= 7 * DAY;
}

export type DiscoverShow = "all" | "projects" | "organizations" | "updates";

/** What the Show filter keeps (report §24.3): cards by kind, and whether update cards appear. */
export function showKeeps(show: DiscoverShow) {
  return {
    projectKind: show === "projects" ? "workspace" : show === "organizations" ? "organization" : null,
    cards: show !== "updates",
    updates: show === "all" || show === "updates",
  };
}

type Nestable = { id: string; projectId: string | null; projectKind?: string | null; parentOrg?: { id: string } | null };

/**
 * Child project entries sit under their org's entry when that entry is shown (report §24.5); otherwise they
 * stay standalone (outside people, hidden org entries). Order is kept.
 */
export function nestContributions<T extends Nestable>(entries: T[]): Array<T & { children: T[] }> {
  const orgIds = new Set(entries.filter((e) => e.projectKind === "organization" && e.projectId).map((e) => e.projectId!));
  const nested = new Set<string>();
  const childrenOf = new Map<string, T[]>();
  for (const e of entries) {
    const parent = e.parentOrg?.id;
    if (parent && orgIds.has(parent)) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), e]);
      nested.add(e.id);
    }
  }
  return entries.filter((e) => !nested.has(e.id)).map((e) => ({ ...e, children: (e.projectId && childrenOf.get(e.projectId)) || [] }));
}

type ProfileEntry = Nestable & {
  endDate?: string | null;
  endReason?: string | null;
  publishedAt?: string | null;
  presentation?: unknown;
  profileOrder?: number | null;
  showOnProfile?: boolean | null;
  projectTitle?: string | null;
};

const removed = (e: ProfileEntry) => e.endReason === "removed" && (e.projectKind === "organization" || Boolean(e.parentOrg));

/**
 * The profile's Organizations section (report §4.5, decision 13): current members only, in the person's own order.
 * Others see only what's shown on the profile; the person sees everything, hidden ones marked.
 */
export function currentOrganizations<T extends ProfileEntry>(entries: T[], isOwner: boolean): T[] {
  return entries
    .filter((e) => e.projectKind === "organization" && !e.endDate && !e.endReason && (isOwner || e.showOnProfile !== false))
    .sort((a, b) => (a.profileOrder ?? Number.MAX_SAFE_INTEGER) - (b.profileOrder ?? Number.MAX_SAFE_INTEGER) || (a.projectTitle ?? "").localeCompare(b.projectTitle ?? ""));
}

/**
 * Contributions in four groups (report §4.5, §16.9): organizations with their workspaces nested, then workspaces.
 * The person's own view adds drafts ("Not on your profile yet") and removed entries ("Private to you").
 */
export function groupProfileContributions<T extends ProfileEntry>(entries: T[], isOwner: boolean) {
  const privateToYou = isOwner ? entries.filter(removed) : [];
  const live = entries.filter((e) => !removed(e));
  const published = (e: T) => !isOwner || Boolean(e.publishedAt || e.presentation);
  const drafts = isOwner ? live.filter((e) => !published(e)) : [];
  const shown = nestContributions(live.filter(published));
  return {
    organizations: shown.filter((e) => e.projectKind === "organization"),
    workspaces: shown.filter((e) => e.projectKind !== "organization"),
    drafts,
    privateToYou,
  };
}

/** The status chip (report §4.5): Left or Completed; nothing for a current entry. Old endings without a reason read as Left. */
export function entryStatus(e: ProfileEntry): "Left" | "Completed" | null {
  if (e.endReason === "term_ended") return "Completed";
  return e.endDate || e.endReason === "left" ? "Left" : null;
}

/** Each row's status in the contribution editor (report §16.10, §38.3). */
export function editorEntryStatus(e: ProfileEntry & { visibility?: string | null }): "Published" | "Draft" | "Hidden" | "Left" | "Completed" | "Private to you" {
  if (removed(e)) return "Private to you";
  const ended = entryStatus(e);
  if (ended) return ended;
  if (!e.publishedAt && !e.presentation) return "Draft";
  if (e.visibility === "private" || (e.presentation as { visible?: boolean } | null)?.visible === false) return "Hidden";
  return "Published";
}
