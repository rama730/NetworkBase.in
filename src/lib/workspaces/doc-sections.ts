/**
 * Report 38.3 F2 S1, S2: Documents rail sections. Pages is the list people have today; the others appear when their
 * workflow is added (Meetings and decisions adds two). A document whose section's workflow is hidden shows in Pages.
 */
export const DOC_SECTIONS = [
  { id: "pages", label: "Pages", workflow: null },
  { id: "meetings", label: "Meetings", workflow: "meetings" },
  { id: "decisions", label: "Decisions", workflow: "meetings" },
  { id: "launches", label: "Launches", workflow: "launches" },
  { id: "goals", label: "Goals", workflow: "goals" },
  { id: "ideas", label: "Ideas", workflow: "ideas" },
  { id: "offsite", label: "Off-site", workflow: "offsite" },
] as const;

export type DocSection = (typeof DOC_SECTIONS)[number]["id"];

export const isDocSection = (value: unknown): value is DocSection => DOC_SECTIONS.some((s) => s.id === value);
export const sectionLabel = (id: DocSection) => DOC_SECTIONS.find((s) => s.id === id)!.label;
/** Meetings and Launches carry a date (S2). */
export const sectionHasDate = (id: DocSection) => id === "meetings" || id === "launches";

/** Sections a document can be in, given the workspace's added workflows; Pages always. */
export const availableSections = (added: string[]): DocSection[] =>
  DOC_SECTIONS.filter((s) => s.workflow === null || added.includes(s.workflow)).map((s) => s.id);

export function docSectionOf(settings: { section?: string }, added: string[]): DocSection {
  return isDocSection(settings.section) && availableSections(added).includes(settings.section) ? settings.section : "pages";
}

type RailDoc = { id: string; filename: string; section?: string; date?: string; decisionNumber?: number };

/** S4: a decision's D-number, never reused or changed (call 6). */
export const decisionLabel = (n: number) => `D-${String(n).padStart(3, "0")}`;
/** The workspace's next D-number: the highest plus one, so gaps stay gaps. */
export const nextDecisionNumber = (existing: Array<number | null | undefined>) => Math.max(0, ...existing.filter((n): n is number => typeof n === "number")) + 1;
const monthDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The rail's sections in their fixed order (S1). Empty while only Pages is available, so workspaces without a document
 * workflow keep today's flat list. Meetings sort newest first with the date before the title.
 */
export function railSections<T extends RailDoc>(docs: T[], added: string[]) {
  const sections = availableSections(added);
  if (sections.length === 1) return [];
  return sections.map((id) => {
    const inSection = docs.filter((d) => docSectionOf(d, added) === id);
    const sorted = id === "meetings"
      ? [...inSection].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      : id === "decisions" ? [...inSection].sort((a, b) => (b.decisionNumber ?? 0) - (a.decisionNumber ?? 0)) : inSection;
    const prefix = (d: T) => (id === "meetings" && d.date ? monthDay(d.date) : id === "decisions" && d.decisionNumber ? decisionLabel(d.decisionNumber) : null);
    return { id, label: sectionLabel(id), docs: sorted.map((d) => ({ ...d, prefix: prefix(d) })) };
  });
}
