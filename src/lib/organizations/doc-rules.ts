// Org Docs rules (report §19), pure so the server, the rail and the template copy agree.

/** A doc group; the id survives renames, so docs keep their group (report §19.2). */
export type DocGroup = { id: string; name: string };

export const DEFAULT_DOC_GROUPS: DocGroup[] = [
  { id: "start", name: "Getting started" },
  { id: "guides", name: "Guides and policies" },
  { id: "notes", name: "Team notes" },
  { id: "templates", name: "Templates" },
];

/** Report 33.2 call 2 (B4.1): a company starts with a sectioned Handbook instead of one page. */
export const COMPANY_DOC_GROUPS: DocGroup[] = [
  { id: "overview", name: "Overview" },
  { id: "how", name: "How we work" },
  { id: "people", name: "People" },
  { id: "policies", name: "Policies" },
];

/** Org options kept in project_docs.settings.org (report §19.3, §19.11). */
export type OrgDocOptions = {
  group: string;
  required: boolean;
  template: boolean;
  showInChildren: boolean;
  /** Bumped by "Ask members to re-read"; an open below it is stale. */
  readVersion: number;
  /** Report §37.4, decision 101: new documents start as drafts; older ones (null) read live, as before. */
  lifecycle: "draft" | "published" | null;
  /** When it was last published; "Updated" and Unpublished changes count from here. */
  publishedAt: string | null;
  /** Report 33.2 call 3: the page's owner (a person in the organization) and when it should be checked again. */
  owner: string | null;
  reviewBy: string | null;
};

export function readDocGroups(value: unknown, orgType?: string | null): DocGroup[] {
  const groups = Array.isArray(value)
    ? value.filter((g): g is DocGroup => Boolean(g) && typeof g.id === "string" && typeof g.name === "string" && g.name.trim().length > 0)
    : [];
  return groups.length ? groups : orgType === "company" ? COMPANY_DOC_GROUPS : DEFAULT_DOC_GROUPS;
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
    lifecycle: o.lifecycle === "draft" || o.lifecycle === "published" ? o.lifecycle : null,
    publishedAt: typeof o.publishedAt === "string" ? o.publishedAt : null,
    owner: typeof o.owner === "string" && /^[0-9a-f-]{36}$/i.test(o.owner) ? o.owner : null,
    reviewBy: typeof o.reviewBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.reviewBy) ? o.reviewBy : null,
  };
}

/** Late pages are marked Needs review, never hidden (report 33.2 call 3). Dates are YYYY-MM-DD. */
export const needsReview = (reviewBy: string | null, today: string) => Boolean(reviewBy && reviewBy <= today);

/** The next Review by: `months` after today (the 31st clamps to the month's last day); 0 = no review cycle. */
export function nextReviewBy(today: string, months: number): string | null {
  if (!months) return null;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
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
  return `${docTitle(templateName)}: ${project} — ${date}`;
}

/** Filenames can't hold "/" or ":" in every store; keep the title readable. */
export function docFileName(title: string) {
  const clean = title.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
  return `${clean}.md`;
}

/**
 * Where a document stands for its admins (report §37.4): a Draft nobody else sees, Published, or Published with
 * changes not yet published. A file-backed document has changes when the file moved on after publishing; a
 * version-backed one when a newer version exists than the published one.
 */
export function docState(input: { lifecycle: OrgDocOptions["lifecycle"]; publishedAt: string | null; fileUpdatedAt: Date | null; latestVersionId: string | null; publishedVersionId: string | null; linked: boolean }): "draft" | "published" | "changed" {
  if (input.lifecycle === "draft") return "draft";
  if (input.linked) {
    return input.lifecycle === "published" && input.publishedAt && input.fileUpdatedAt && input.fileUpdatedAt.getTime() > Date.parse(input.publishedAt) ? "changed" : "published";
  }
  if (!input.publishedVersionId) return "draft";
  return input.latestVersionId && input.latestVersionId !== input.publishedVersionId ? "changed" : "published";
}

/** A document's title is its file name without the Markdown extension (live-fix 25). */
export function docTitle(filename: string) {
  return filename.replace(/\.(md|mdx|markdown)$/i, "");
}

/** Empty: nothing but whitespace, or only a heading equal to its title, as a new document starts (live-fix 23). */
export function isEmptyDoc(content: string, title: string) {
  const text = content.trim();
  if (!text) return true;
  const heading = /^#{1,6}\s+(.+)$/.exec(text);
  return Boolean(heading && !text.includes("\n") && heading[1]!.trim().toLowerCase() === title.trim().toLowerCase());
}

