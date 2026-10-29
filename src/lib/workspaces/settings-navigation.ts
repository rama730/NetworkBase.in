import type { WorkspaceSettingsSectionId } from "./settings-policies";

export function resolveWorkspaceSettingsSection(
  requested: string | null | undefined,
  available: readonly { id: WorkspaceSettingsSectionId }[],
): WorkspaceSettingsSectionId {
  const raw = requested?.replace(/^#?project-settings-/, "");
  const normalized =
    raw === "privacy" || raw === "privacy-terms"
      ? "privacy-policies"
      : raw === "security-audit" || raw === "security-data"
        ? "general"
        : raw;
  return (
    available.find((section) => section.id === normalized)?.id ??
    available[0]?.id ??
    "general"
  );
}

export function selectVisibleSettingsSection(
  sections: readonly {
    id: WorkspaceSettingsSectionId;
    top: number;
    bottom: number;
  }[],
  contentTop: number,
  atEnd = false,
): WorkspaceSettingsSectionId | undefined {
  if (atEnd) return sections.at(-1)?.id;
  // The heading closest to the sticky tab edge represents the section in view.
  return sections
    .filter((section) => section.bottom > contentTop + 16)
    .reduce<
      (typeof sections)[number] | undefined
    >((closest, section) => (!closest || Math.abs(section.top - contentTop) < Math.abs(closest.top - contentTop) ? section : closest), undefined)
    ?.id;
}
