/** Who can post where (org #general admins-only, read-only workspaces), as getChannel reports it. */
export type ChatPosting = {
  generalAdminsOnly: boolean;
  /** The org's owner or an admin: posts at the top level of an admins-only #general. */
  orgAdmin: boolean;
  readOnly: { reason: "suspended" | "archived" | "deleting"; title: string } | null;
};

const READ_ONLY_TAG = { suspended: "Suspended", archived: "Archived", deleting: "Deleting" } as const;

/**
 * What takes the composer's place, or sits under it: a blocked footer (read-only, or a member in an
 * admins-only #general, where threads stay open), a quiet hint for the admins who can post, or nothing.
 */
export function postingFooter(posting: ChatPosting | null | undefined):
  | { kind: "blocked"; tag: string; line: string; reason: string | null }
  | { kind: "hint"; hint: string }
  | null {
  if (!posting) return null;
  const { readOnly } = posting;
  if (readOnly) {
    const what = readOnly.reason === "suspended" ? "is suspended" : readOnly.reason === "archived" ? "was archived" : "is scheduled for deletion";
    return { kind: "blocked", tag: READ_ONLY_TAG[readOnly.reason], line: "This workspace is read-only.", reason: `${readOnly.title} ${what}. You can still read and search.` };
  }
  if (!posting.generalAdminsOnly) return null;
  if (!posting.orgAdmin) return { kind: "blocked", tag: "Admins only", line: "Only admins post in #general. Reply in a thread.", reason: null };
  return { kind: "hint", hint: "Only admins post here · everyone replies in threads" };
}
