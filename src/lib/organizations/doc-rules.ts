// Org Docs rules (report §19), pure so the server, the rail and the template copy agree.

/** A doc group; the id survives renames, so docs keep their group (report §19.2). */
export type DocGroup = { id: string; name: string };

export const DEFAULT_DOC_GROUPS: DocGroup[] = [
  { id: "start", name: "Getting started" },
  { id: "guides", name: "Guides & policies" },
  { id: "notes", name: "Unit notes" },
  { id: "templates", name: "Templates" },
];

/** Org options kept in project_docs.settings.org (report §19.3, §19.11). */
export type OrgDocOptions = {
  group: string;
  required: boolean;
  template: boolean;
  showInChildren: boolean;
  /** Bumped by "Ask members to re-read"; an open below it is stale. */
  readVersion: number;
};

export function readDocGroups(value: unknown): DocGroup[] {
  const groups = Array.isArray(value)
    ? value.filter((g): g is DocGroup => Boolean(g) && typeof g.id === "string" && typeof g.name === "string" && g.name.trim().length > 0)
    : [];
  return groups.length ? groups : DEFAULT_DOC_GROUPS;
}

export function readOrgDocOptions(value: unknown, groups: DocGroup[] = DEFAULT_DOC_GROUPS): OrgDocOptions {
  const o = value && typeof value === "object" ? (value as Partial<OrgDocOptions>) : {};
  const template = o.template === true;
  const fallback = template ? groups.find((g) => g.id === "templates")?.id ?? groups[0]!.id : groups[0]!.id;
  return {
    // A removed group's docs fall back to the first group.
    group: typeof o.group === "string" && groups.some((g) => g.id === o.group) ? o.group : fallback,
    required: o.required === true,
    template,
    showInChildren: o.showInChildren !== false,
    readVersion: Number.isInteger(o.readVersion) && (o.readVersion as number) > 0 ? (o.readVersion as number) : 0,
  };
}

const UPDATED_DAYS = 7;

/**
 * New: never opened at this re-read version. Updated: the file changed in the last 7 days after the
 * viewer's last open (report §19.4). Required docs stay New until opened.
 */
export function docLabel(input: { readVersion: number; opened: { version: number; at: Date } | null; updatedAt: Date | null; now?: Date }): "new" | "updated" | null {
  const now = input.now ?? new Date();
  if (!input.opened || input.opened.version < input.readVersion) return "new";
  const updated = input.updatedAt;
  if (updated && updated > input.opened.at && now.getTime() - updated.getTime() < UPDATED_DAYS * 86_400_000) return "updated";
  return null;
}

/** "Lab report" + Compiler Lab → "Lab report: Compiler Lab — Oct 30" with {{project}}, {{team}}, {{date}} filled (§19.7). */
export function fillDocTemplate(content: string, values: { project: string; team: string; date: string }) {
  return content.replace(/\{\{\s*(project|team|date)\s*\}\}/g, (_, key: "project" | "team" | "date") => values[key]);
}

export function templateCopyTitle(templateName: string, project: string, date: string) {
  return `${templateName.replace(/\.(md|mdx|markdown)$/i, "")}: ${project} — ${date}`;
}

/** Filenames can't hold "/" or ":" in every store; keep the title readable. */
export function docFileName(title: string) {
  const clean = title.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
  return `${clean}.md`;
}
