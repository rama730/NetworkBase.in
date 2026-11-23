import { z } from "zod";

/**
 * Report 38.7 T4 (plan A2.4): Requests. A request is a task with item_type "request"; its type's id and the asker's
 * answers live in type_fields. Request types are workspace settings (workspaces.workflow_settings.requests.types):
 * up to 12 types, 5 questions each (call 8). Response times are working minutes, null = Off (call 1).
 */
export const QUESTION_KINDS = ["text", "long_text", "choice", "date", "file"] as const;
const question = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(QUESTION_KINDS),
  options: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  required: z.boolean(),
}).strict().refine((q) => q.kind !== "choice" || (q.options?.length ?? 0) >= 2, { message: "A choice needs at least 2 options" });
// Up to 30 working days (security review: keeps every deadline calculation short).
export const MAX_CLOCK_MINUTES = 30 * 480;
const minutes = z.number().int().min(1).max(MAX_CLOCK_MINUTES).nullable();
export const requestTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  icon: z.string().regex(/^[A-Za-z0-9]{1,40}$/),
  questions: z.array(question).max(5),
  triagerIds: z.array(z.string().uuid()).max(50),
  firstReplyMinutes: minutes,
  deliverMinutes: minutes,
  archivedAt: z.string().datetime().nullable(),
}).strict();
export type RequestType = z.infer<typeof requestTypeSchema>;
export type Question = RequestType["questions"][number];
export const MAX_TYPES = 12;

/** What a request keeps in type_fields as people write it (the ask form, the CLI); actions write the rest. */
export const requestFieldsSchema = z.object({
  requestTypeId: z.string().uuid().optional(),
  answers: z.record(z.string().max(40), z.union([z.string().max(5000), z.array(z.string().uuid()).max(10)])).optional(),
}).strict();
export type RequestFields = z.infer<typeof requestFieldsSchema> & {
  firstRepliedAt?: string | null; acceptedAt?: string | null; declineReason?: string | null;
};

const id = () => globalThis.crypto.randomUUID();

/** Rollout 2: written when Requests is first added (W2, W3). */
export function starterTypes(): RequestType[] {
  return [
    { id: id(), name: "General request", icon: "Inbox", triagerIds: [], firstReplyMinutes: 240, deliverMinutes: null, archivedAt: null, questions: [
      { id: "need", label: "What do you need?", kind: "text", required: true },
      { id: "why", label: "Why now?", kind: "text", required: false },
    ] },
    { id: id(), name: "Design request", icon: "Palette", triagerIds: [], firstReplyMinutes: 480, deliverMinutes: 2400, archivedAt: null, questions: [
      { id: "what", label: "What’s needed", kind: "choice", options: ["Social graphic", "Banner", "Deck", "Video edit", "Other"], required: true },
      { id: "size", label: "Size or format", kind: "text", required: false },
      { id: "brief", label: "Brief", kind: "long_text", required: true },
      { id: "assets", label: "Assets to use", kind: "file", required: false },
    ] },
  ];
}

export const activeTypes = (types: RequestType[]) => types.filter((t) => !t.archivedAt);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Part 7: the asker's answers against the type's questions; null when they're fine. A past date is allowed. */
export function validateAnswers(type: RequestType, answers: Record<string, unknown>) {
  for (const key of Object.keys(answers)) if (!type.questions.some((q) => q.id === key)) return `There’s no question “${key}” in ${type.name}`;
  for (const q of type.questions) {
    const v = answers[q.id];
    const empty = v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
    if (empty) { if (q.required) return `Answer “${q.label}”`; continue; }
    if (q.kind === "file") { if (!Array.isArray(v) || !v.every((f) => typeof f === "string" && UUID.test(f))) return `Check the files for “${q.label}”`; continue; }
    if (typeof v !== "string") return `Answer “${q.label}” in words`;
    if (q.kind === "choice" && !q.options?.includes(v)) return `Pick one of the options for “${q.label}”`;
    if (q.kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) return `Pick a date for “${q.label}”`;
  }
  return null;
}

/** "4 working hours", "1 working day" (a day is 8 working hours). */
export function workingTime(min: number) {
  if (min % 480 === 0) { const d = min / 480; return `${d} working ${d === 1 ? "day" : "days"}`; }
  const h = Math.round((min / 60) * 10) / 10;
  return `${h} working ${h === 1 ? "hour" : "hours"}`;
}

/** The ask form's footer times (W2.5, W3.2). */
export function requestFooter(t: Pick<RequestType, "firstReplyMinutes" | "deliverMinutes">) {
  return [t.firstReplyMinutes ? `first reply within ${workingTime(t.firstReplyMinutes)}` : "", t.deliverMinutes ? `deliver within ${workingTime(t.deliverMinutes)}` : ""].filter(Boolean).join(" · ");
}

/** S4 Inbox: New requests, oldest first. */
export const inboxOrder = <T extends { stage: string | null; createdAt: string }>(rows: T[]) =>
  rows.filter((r) => r.stage === "new").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
