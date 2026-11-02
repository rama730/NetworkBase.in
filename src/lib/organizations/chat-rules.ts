import { typeProfile } from "@/lib/organizations/type-profile";

// Org Messages rules (report §25), pure so the SQL (0249), the server and the chat sidebar agree.

/** A child project's default channel is named after its handle (`#compiler-lab`); others keep `#general`. */
export function defaultChannelName(handleOrTitle: string | null, isChild: boolean) {
  if (!isChild) return "general";
  const name = (handleOrTitle ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return name || "general";
}

/** Org chat settings with their type defaults (report §25.4): Education keeps channel creation for admins. */
export function orgChatSettings(orgSettings: unknown, orgType: string | null) {
  const s = (orgSettings && typeof orgSettings === "object" ? orgSettings : {}) as { membersCreateChannels?: unknown; generalAdminsOnly?: unknown; generalNotify?: unknown };
  return {
    membersCreateChannels: typeof s.membersCreateChannels === "boolean" ? s.membersCreateChannels : typeProfile(orgType).membersPost,
    generalAdminsOnly: s.generalAdminsOnly === true,
    // New members' #general notify level (0261 applies it on join): Mentions for Education, All otherwise.
    generalNotify: s.generalNotify === "all" || s.generalNotify === "mentions" ? s.generalNotify : typeProfile(orgType).generalNotify,
  };
}

export type ChatWorkspaceWorkspace = { id: string; title: string; kind?: string | null; parent_id?: string | null; parent_title?: string | null; role?: string | null };

/**
 * The workspace list (report §25.1, §25.7): orgs and personal projects get a tile; a child project lives inside
 * its org's workspace. Someone in a child project but not in its org (an outside person) sees it on its own,
 * labelled "<Org> · Viewer".
 */
export function workspaceWorkspaces<T extends ChatWorkspaceWorkspace>(projects: T[]): Array<T & { guestOf?: string }> {
  const ids = new Set(projects.map((p) => p.id));
  return projects.flatMap((p) => {
    if (!p.parent_id) return [p];
    if (ids.has(p.parent_id)) return [];
    return [{ ...p, guestOf: p.parent_title ?? "Organization" }];
  });
}

/** The child project groups inside an org workspace, by title. */
export function childWorkspacesOf<T extends ChatWorkspaceWorkspace>(projects: T[], orgId: string): T[] {
  return projects.filter((p) => p.parent_id === orgId).sort((a, b) => a.title.localeCompare(b.title));
}
