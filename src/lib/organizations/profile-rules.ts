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
