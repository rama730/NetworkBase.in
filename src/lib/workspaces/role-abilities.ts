/**
 * What each role may do in a workspace (member settings Part 4). One row per ability, a column per role. The defaults
 * are today's rules exactly; `workspaces.role_abilities` stores only what the owner changed, and null means today's
 * rules. Viewers never get a write ability. Organizations and their team workspaces follow the organization's own
 * permission table, so their abilities are always the defaults here (shown read-only).
 *
 * The SQL mirror is `app_private.nb_workspace_role_allows()` (0114); tests/db/role-abilities.test.ts keeps them equal.
 */
export type AbilityRole = "admin" | "member" | "viewer";

export const ROLE_ABILITIES = [
  { key: "tasks.create", label: "Create tasks", help: "Add tasks to the board.", write: true, defaults: { admin: true, member: true, viewer: false } },
  { key: "tasks.edit", label: "Edit and move tasks", help: "Change, assign and move tasks.", write: true, defaults: { admin: true, member: true, viewer: false } },
  { key: "tasks.delete", label: "Delete tasks", help: "Off for everyone but the owner unless you turn it on.", write: true, defaults: { admin: false, member: false, viewer: false } },
  { key: "files.upload", label: "Upload files", help: "Add and change workspace files. A member's own upload switch still applies.", write: true, defaults: { admin: true, member: true, viewer: false } },
  { key: "members.invite", label: "Invite people", help: "Invite someone into an open role.", write: true, defaults: { admin: true, member: false, viewer: false } },
  { key: "files.see", label: "See Files", help: "Open the Files tab and its files.", write: false, defaults: { admin: true, member: true, viewer: true } },
  { key: "docs.drafts", label: "See and edit doc drafts", help: "Where the doc lets members edit.", write: true, defaults: { admin: true, member: true, viewer: false } },
  { key: "agents.use", label: "Use agents", help: "Claude Code and other agents signed in as them.", write: false, defaults: { admin: true, member: true, viewer: true } },
  { key: "export", label: "Export the workspace", help: "Download everything as one zip.", write: false, defaults: { admin: true, member: false, viewer: false } },
] as const;

export type RoleAbility = (typeof ROLE_ABILITIES)[number]["key"];
export type RoleAbilities = Partial<Record<AbilityRole, Partial<Record<RoleAbility, boolean>>>>;

const BY_KEY = new Map(ROLE_ABILITIES.map((a) => [a.key, a]));
const ROLES: AbilityRole[] = ["admin", "member", "viewer"];
// Read abilities a viewer may keep or lose; everything else stays off for viewers.
const VIEWER_ALLOWED = new Set<RoleAbility>(["files.see", "agents.use"]);

/** Whether the owner may change this cell (viewers never get write abilities, nor export). */
export function abilityEditable(role: AbilityRole, ability: RoleAbility) {
  return role !== "viewer" || VIEWER_ALLOWED.has(ability);
}

/** Only known roles and abilities, only booleans, only cells that differ from today's rules. Null when nothing differs. */
export function normalizeRoleAbilities(value: unknown): RoleAbilities | null {
  if (!value || typeof value !== "object") return null;
  const out: RoleAbilities = {};
  for (const role of ROLES) {
    const cells = (value as Record<string, unknown>)[role];
    if (!cells || typeof cells !== "object") continue;
    for (const [key, on] of Object.entries(cells as Record<string, unknown>)) {
      const ability = BY_KEY.get(key as RoleAbility);
      if (!ability || typeof on !== "boolean" || !abilityEditable(role, ability.key)) continue;
      if (on === ability.defaults[role]) continue;
      (out[role] ??= {})[ability.key] = on;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * May this role do this here? The owner always may; people outside the workspace never do. `orgRules`: an
 * organization or a team workspace in one, where the organization's table decides and these stay the defaults.
 */
export function roleAllows(abilities: unknown, role: string | null | undefined, ability: RoleAbility, opts: { isOwner?: boolean; orgRules?: boolean } = {}) {
  if (opts.isOwner || role === "owner") return true;
  if (role !== "admin" && role !== "member" && role !== "viewer") return false;
  const def = BY_KEY.get(ability)!;
  if (!abilityEditable(role, ability)) return def.defaults[role];
  if (opts.orgRules) return def.defaults[role];
  const set = normalizeRoleAbilities(abilities)?.[role]?.[ability];
  return set ?? def.defaults[role];
}
