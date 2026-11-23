import { liveBlockLine } from "@/lib/workspaces/doc-live-blocks";

/**
 * Report 38.14 D5 (plan A5.4): a team off-site is a document in the Off-site section with dates, a place, who's
 * invited and their Going / Can't go answers (document settings), an agenda by day, and four checklists whose rows
 * are tasks. Never public.
 */
export type OffsiteAnswer = "going" | "cant";
export const OFFSITE_BLOCKS = [
  { key: "before", label: "Before", rows: ["Pick dates", "Book venue", "Share agenda"] },
  { key: "travel", label: "Travel and rooms", rows: ["Book rooms"] },
  { key: "sessions", label: "Sessions", rows: [] as string[] },
  { key: "after", label: "After", rows: ["Share notes", "Upload photos"] },
] as const;

export function offsiteCounts(invited: string[], answers: Record<string, string>) {
  const going = invited.filter((id) => answers[id] === "going").length;
  const cant = invited.filter((id) => answers[id] === "cant").length;
  return { going, cant, unanswered: invited.length - going - cant };
}

/** Call 3: one "Book travel" row per invitee, assigned to them. */
export const travelRows = (invitees: Array<{ id: string; name: string }>) => invitees.map((p) => ({ title: `Book travel — ${p.name}`, assigneeId: p.id }));

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");

/** W1: the document: title, the agenda by day (Markdown), and the four checklists. */
export function offsiteMarkdown(name: string, from: string, to: string) {
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`), i = 1; d <= new Date(`${to}T00:00:00Z`) && i <= 14; d.setUTCDate(d.getUTCDate() + 1), i++) days.push(`### Day ${i} · ${dayLabel(d.toISOString().slice(0, 10))}\n`);
  const blocks = OFFSITE_BLOCKS.map((b) => `## ${b.label}\n\n${liveBlockLine("task_rows", b.key, b.label)}\n`);
  return `# ${name}\n\n## Agenda\n\n${days.join("\n")}\n${blocks.join("\n")}`;
}

export const daysUntil = (day: string, today: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/** Part 8: "Off-site in 12 days · 2 not answered". */
export function offsiteLine(_name: string, days: number, unanswered: number) {
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `Off-site ${when} · ${unanswered ? `${unanswered} not answered` : "everyone answered"}`;
}
