import { structuredPatch } from "diff";

/**
 * Report D4 and 0.8 #13: the yes prompt for an agent's push names what changes and how much ("Change the README
 * (+5 −2 lines)") and shows the diff, instead of "Push 1 file". `before` and `after` are the texts when known
 * (text files the server could read); null for binary or unread files.
 */
export type PushedFile = { path: string; before: string | null; after: string | null };

const PREVIEW_LINES = 40;

function count(before: string, after: string) {
  const patch = structuredPatch("a", "b", before, after, "", "", { context: 2 });
  let added = 0;
  let removed = 0;
  const lines: string[] = [];
  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
      if (!line.startsWith("\\")) lines.push(line);
    }
  }
  const preview = lines.length > PREVIEW_LINES ? [...lines.slice(0, PREVIEW_LINES), `… ${lines.length - PREVIEW_LINES} more lines`] : lines;
  return { added, removed, preview: preview.join("\n") };
}

const size = (added: number, removed: number) => `(${[added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean).join(" ") || "no"} lines)`;

export function describePush(input: { files: PushedFile[]; doc?: string | null; role?: "final" | "draft" | "reference" | null; taskNumber?: number | null; finish?: boolean }) {
  const { files, doc, role, taskNumber, finish } = input;
  const onTask = role === "final" ? ` as the final file${taskNumber ? ` on #${taskNumber}` : ""}` : "";
  const end = finish ? ` and finish ${taskNumber ? `#${taskNumber}` : "the task"}` : "";
  if (files.length === 1) {
    const f = files[0]!;
    if (f.before !== null && f.after !== null) {
      const c = count(f.before, f.after);
      return { summary: `Change ${doc ? `the ${doc}` : f.path} ${size(c.added, c.removed)}${onTask}${end}`, preview: c.preview };
    }
    if (f.before === null && f.after !== null) {
      const lines = f.after.split("\n").filter((l, i, all) => l !== "" || i < all.length - 1).length;
      return { summary: `Add ${doc ? `the ${doc}` : f.path} (${lines} lines)${onTask}${end}`, preview: f.after.split("\n").slice(0, PREVIEW_LINES).map((l) => `+${l}`).join("\n") };
    }
    return { summary: `${f.before === null ? "Add" : "Change"} ${doc ? `the ${doc}` : f.path}${onTask}${end}`, preview: null };
  }
  const names = files.slice(0, 3).map((f) => f.path).join(", ");
  const more = files.length > 3 ? ` and ${files.length - 3} more` : "";
  return { summary: `Push ${files.length} files${role === "final" ? " as final files" : ""}${taskNumber && role !== "final" ? ` to #${taskNumber}` : ""}: ${names}${more}${end}`, preview: files.slice(0, 30).map((f) => f.path).join("\n") };
}
