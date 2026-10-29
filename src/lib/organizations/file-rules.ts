// Org Files rules (report §23.3), pure so the server, the DB rule (0247) and the Files tab agree.

/** Folder access in an organization; an unmarked folder counts as Members. */
export type FolderAccess = "admins" | "members" | "public";

const RANK: Record<FolderAccess, number> = { public: 0, members: 1, admins: 2 };

/** The strictest mark on a node's folders (itself included); null when none is marked. */
export function effectiveAccess(marks: Array<FolderAccess | null | undefined>): FolderAccess | null {
  return marks.reduce<FolderAccess | null>((strictest, mark) => (mark && (!strictest || RANK[mark] > RANK[strictest]) ? mark : strictest), null);
}

/** Admins see everything; members and guests all but Admins-only; visitors only what sits under Public. */
export function canSeeNode(viewer: "admin" | "member" | "visitor", effective: FolderAccess | null) {
  if (viewer === "admin") return true;
  if (viewer === "member") return effective !== "admins";
  return effective === "public";
}

/** Access is only stricter going down: a folder can't be more open than its parent folders (§23.3). */
export function folderAccessBlock(parentEffective: FolderAccess | null, next: FolderAccess | null): string | null {
  const floor = parentEffective ?? null;
  if (!floor || !next) return null;
  return RANK[next] < RANK[floor] ? `A folder inside ${floor === "admins" ? "Admins only" : "Members"} can't be more open than it.` : null;
}

export function readFolderAccess(metadata: unknown): FolderAccess | null {
  const value = metadata && typeof metadata === "object" ? (metadata as { access?: unknown }).access : null;
  return value === "admins" || value === "members" || value === "public" ? value : null;
}

/** Starter folders by org type (§23.3); the last one is Admins only. Docs is where New doc lands (§19.3). */
export function starterFolders(orgType: string | null | undefined): Array<{ name: string; access: FolderAccess | null }> {
  const [shared, staff] = orgType === "education" ? ["Course materials", "Staff"] : orgType === "company" ? ["Shared", "Managers"] : ["Shared", "Admins"];
  return [
    { name: shared, access: null },
    { name: "Docs", access: null },
    { name: "Templates", access: null },
    { name: staff, access: "admins" },
  ];
}
