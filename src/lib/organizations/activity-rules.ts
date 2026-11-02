// The one activity item (report §5.3): its icon per kind and the time it shows. Pure, so the server and screens agree.

export type ActivityKind = "sprint" | "workspace" | "join" | "announcement" | "document" | "file" | "assignment" | "submission" | "task" | "github";

const ICONS: Record<ActivityKind, string> = {
  sprint: "IterationCcw", workspace: "FolderKanban", join: "UserRoundPlus", announcement: "Megaphone", document: "BookOpenText",
  file: "FilePlus2", assignment: "ClipboardCheck", submission: "CheckCircle2", task: "ListTodo", github: "GitBranch",
};
// The organization feed and the workspace feed name some kinds their own way; they read as the same kind here.
const ALIASES: Record<string, ActivityKind> = { project: "workspace", joins: "join", member: "join", doc: "document" };

/** The lucide icon name for a kind (report §5.3); unknown kinds read as a task. */
export function activityIcon(kind: string) {
  return ICONS[(ALIASES[kind] ?? kind) as ActivityKind] ?? ICONS.task;
}

/** Real event time, always: a sprint uses when it actually started, never its planned date (parity bug 3). */
export function activityTime(item: { kind: string; at?: Date | null; startedAt?: Date | null; plannedStart?: Date | null }): Date {
  if (item.kind === "sprint") return item.startedAt ?? item.at ?? item.plannedStart ?? new Date(0);
  return item.at ?? new Date(0);
}
