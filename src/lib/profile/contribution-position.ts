const membershipLabels: Record<string, string> = {
  owner: "Lead",
  admin: "Co-lead",
  member: "Member",
  viewer: "Viewer",
};
const genericRole =
  /^(?:owner|lead|leader|admin|co-lead|co-leader|member|viewer|contributor)$/i;
const leadingMembership =
  /^(?:owner|lead|leader|admin|co-lead|co-leader|member|viewer|contributor)(?:\s*[/·|]\s*|\s+[-–—]\s+)/i;
const trailingMembership =
  /(?:\s*[/·|]\s*|\s+[-–—]\s+)(?:owner|lead|leader|admin|co-lead|co-leader|member|viewer|contributor)$/i;

/** Separate the actual position from legacy membership decorations, including "Lead - Lead". */
export function contributionPositionName(
  value: string | null | undefined,
): string {
  let name = value?.trim() ?? "";
  let previous: string;
  do {
    previous = name;
    name = name
      .replace(leadingMembership, "")
      .replace(trailingMembership, "")
      .trim();
  } while (name !== previous);
  return genericRole.test(name) ? "" : name;
}

export function formatContributionPosition(input: {
  roleKind: string | null | undefined;
  title?: string | null;
  projectPosition?: string | null;
}): string {
  const name =
    contributionPositionName(input.projectPosition) ||
    contributionPositionName(input.title);
  const membership = membershipLabels[input.roleKind ?? ""];
  return name && membership
    ? `${name} · ${membership}`
    : name || membership || "Contributor";
}
