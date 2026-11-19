/**
 * Report 38.3 F2 part 7: live blocks in documents. A block is one line, `{% project.task_rows key="k7f3" label="Action
 * items" %}`; its rows are tasks that point at the document and the key (call 1), so the text never changes when rows do.
 */
export const MAX_BLOCK_ROWS = 200;
export const FOLD_AFTER_DAYS = 7;

export type LiveBlockKind = "task_rows" | "unknown";
export type LiveBlock = { kind: LiveBlockKind; key: string | null; label: string | null; raw: string };

const BLOCK = /\{%\s*project\.([a-z_]+)([^%]*)%\}/gi;
const attr = (params: string, name: string) => params.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? null;

/** The live blocks in a document's text, outside code fences. A task_rows block without a key still renders, read-only. */
export function parseLiveBlocks(markdown: string): LiveBlock[] {
  const outsideCode = markdown.replace(/```[\s\S]*?```/g, (fence) => fence.replace(/\{%/g, "{ %"));
  return Array.from(outsideCode.matchAll(BLOCK)).flatMap((match) => {
    const name = match[1]!.toLowerCase();
    const params = match[2] ?? "";
    if (["roles", "contributors", "files", "tasks", "sprints", "projects"].includes(name)) return [];
    const kind: LiveBlockKind = name === "task_rows" ? "task_rows" : "unknown";
    const key = attr(params, "key");
    return [{ kind, key: key && /^[a-z0-9]{4,12}$/.test(key) ? key : null, label: kind === "task_rows" ? attr(params, "label") || "Action items" : null, raw: match[0] }];
  });
}

/** A fresh 4–6 character key not used in the document. */
export function newBlockKey(existing: string[]) {
  const used = new Set(existing);
  for (let length = 4; ; length = Math.min(6, length + 1)) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const key = Array.from({ length }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
      if (!used.has(key)) return key;
    }
  }
}

export const liveBlockLine = (kind: "task_rows", key: string, label: string) => `{% project.${kind} key="${key}" label="${label.replace(/"/g, "")}" %}`;

/** B9: adding rows follows the document's edit permission; ticking follows the task's. */
export const canAddRows = (doc: { canEdit: boolean }) => doc.canEdit;
export const canTickRow = (task: { canEditTask: boolean }) => task.canEditTask;

type OrderedRow = { position: number | null; status: string; completedAt: string | null };

/** Open rows first by position; completed rows stay in place for 7 days, then fold under "Completed" (call 4). */
export function orderRows<T extends OrderedRow>(rows: T[], now = new Date()) {
  const foldBefore = now.getTime() - FOLD_AFTER_DAYS * 86_400_000;
  const folds = (r: T) => r.status === "done" && r.completedAt !== null && new Date(r.completedAt).getTime() < foldBefore;
  const byPosition = [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return { shown: byPosition.filter((r) => !folds(r)), folded: byPosition.filter(folds) };
}

/** W12: people who can't see Tasks see the frame and a count, never the rows. */
export function visibleRows<T>(rows: T[], viewer: { canSeeTasks: boolean }) {
  return viewer.canSeeTasks ? { rows, hidden: 0 } : { rows: [] as T[], hidden: rows.length };
}
