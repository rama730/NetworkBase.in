import { STORY_REFERENCE_PATTERN } from "@/lib/profile/contribution-story";

// Small text helpers for the contribution editor (live-fix 60, 64, 65).

export const roleCount = (n: number) => `${n} ${n === 1 ? "position" : "positions"}`;

/** A list preview: mentions become their names, Markdown marks and backslash escapes go (live-fix 60). */
export function previewText(summary: string, refs: Array<{ kind: string; id: string; label: string }>) {
  return summary
    .replace(new RegExp(STORY_REFERENCE_PATTERN), (_m, kind: string, id: string) => refs.find((ref) => ref.kind === kind && ref.id === id)?.label ?? "")
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1")
    // Hard line breaks are a lone backslash before a newline; nothing of them belongs in a one-line preview.
    .replace(/\\/g, "")
    .replace(/[*#_`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Why a contribution doesn't show to visitors, first reason first (live-fix 65). */
export function hiddenReason(c: { visibility?: string | null; presentation?: { visible?: boolean } | null; projectVisibility?: string | null; projectStatus?: string | null }, profileVisibility: string | null | undefined) {
  if (!c.presentation) return "It isn’t published yet. Publish it to show it.";
  if (c.visibility === "private" || c.presentation.visible === false) return "Show on profile is off for it.";
  if (c.projectVisibility === "private") return "Its workspace is private.";
  if (["draft", "deleted"].includes(c.projectStatus ?? "")) return "Its workspace isn’t live.";
  if (profileVisibility !== "public") return "Your profile isn’t public.";
  return null;
}
