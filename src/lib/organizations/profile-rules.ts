// Org cards, Discover and profile rules (report §24), pure so server, cards and profile agree.

/**
 * D7 (2026-11-05-org-address-discovery-verification-findings.md §8a, replaces decision 160): a public organization
 * reaches Discover once it looks real — a tagline or description, and at least one workspace or a second member — or
 * once it's verified. No waiting days. `orgQualifiesSql` (lib/discover/listed-sql.ts) is the same rule in SQL.
 */
export const ORG_DISCOVER_MIN_MEMBERS = 2;
export const ORG_DISCOVER_MIN_WORKSPACES = 1;

export type OrgDiscoverInput = { verified: boolean; hasDescription: boolean; workspaces: number; members: number };

/** The rule's parts, so Settings can say which are met. */
export function orgDiscoverParts(input: OrgDiscoverInput) {
  return { description: input.hasDescription, content: input.workspaces >= ORG_DISCOVER_MIN_WORKSPACES || input.members >= ORG_DISCOVER_MIN_MEMBERS };
}

export function orgDiscoverable(input: OrgDiscoverInput) {
  if (input.verified) return true;
  const parts = orgDiscoverParts(input);
  return parts.description && parts.content;
}

export type OrgDiscoverStatus =
  | { state: "private" | "archived" | "deleting" | "suspended" | "hidden" }
  | { state: "waiting"; parts: { description: boolean; content: boolean } }
  | { state: "listed"; verified: boolean };

/**
 * Settings → Visibility and discovery → On Discover (report §4): the first that applies. Mirrors the feed's
 * conditions (`buildBaseConditions`: public, `discoverListedSql`, `orgQualifiesSql`).
 */
export function orgDiscoverStatus(input: OrgDiscoverInput & {
  visibility: string | null; archived: boolean; deletionScheduledAt: string | null; suspended: boolean; discoverHidden: boolean;
}): OrgDiscoverStatus {
  if (input.visibility !== "public" && input.visibility !== "unlisted") return { state: "private" };
  if (input.archived) return { state: "archived" };
  if (input.deletionScheduledAt) return { state: "deleting" };
  if (input.suspended) return { state: "suspended" };
  if (input.discoverHidden) return { state: "hidden" };
  if (orgDiscoverable(input)) return { state: "listed", verified: input.verified };
  return { state: "waiting", parts: orgDiscoverParts(input) };
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
  // Live-fix 53: drafts nest like the rest, a team workspace under its organization.
  const drafts = isOwner ? nestContributions(live.filter((e) => !published(e))) : [];
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
  // Member settings §3: completing your part, or the workspace completing, reads Completed like an ended term.
  if (e.endReason === "term_ended" || e.endReason === "completed" || e.endReason === "workspace_completed") return "Completed";
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

/** "Since Oct 2026" (live-fix 52): the month and year of a YYYY-MM-DD start date, read as a calendar date. */
export function sinceMonth(startDate: string | null | undefined) {
  if (!startDate) return null;
  const d = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(d) : null;
}
