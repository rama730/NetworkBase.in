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

/** A contribution shows what someone did (their role title), never their access level (report §8.2, §15 #4). */
export function formatContributionPosition(input: {
  title?: string | null;
  projectPosition?: string | null;
}): string {
  const name =
    contributionPositionName(input.projectPosition) ||
    contributionPositionName(input.title);
  return name || "Contributor";
}
