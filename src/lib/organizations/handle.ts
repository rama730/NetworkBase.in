import { isReservedProjectSlug } from "@/lib/utils/slug";
import { CORE_RESERVED_USERNAMES, normalizeUsername } from "@/lib/validations/username";

const ORG_RESERVED = new Set<string>([
  ...CORE_RESERVED_USERNAMES,
  "org", "orgs", "join", "invite", "team", "teams", "class", "official", "verified",
  "staff", "security", "abuse", "billing", "status", "docs", "blog", "networkbase",
]);

// 3–40 of a–z 0–9 -, letter or digit at both ends; "--" is rejected separately.
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export type OrgHandleResult = { ok: true; handle: string } | { ok: false; reason: "format" | "reserved" };

/**
 * Org handle rules (report §30.2). Pure checks only; uniqueness against project slugs, held handles
 * and the reserved_usernames table needs the database and lives with the create and rename actions.
 */
export function validateOrgHandle(raw: string): OrgHandleResult {
  const handle = normalizeUsername(raw);
  if (!HANDLE_PATTERN.test(handle) || handle.includes("--")) return { ok: false, reason: "format" };
  if (ORG_RESERVED.has(handle) || isReservedProjectSlug(handle)) return { ok: false, reason: "reserved" };
  return { ok: true, handle };
}
