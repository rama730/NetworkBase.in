// Report 33.5 (plan B4.4, K4): a company's onboarding plan — steps with a day offset from the start date, who each is
// for and what kind — and the pure rules for due dates, phases and progress. Client-safe.

export type StepWho = "person" | "manager" | "buddy";
export type StepKind = "read" | "do" | "meet" | "answer";
export type PlanStep = { id: string; day: number; who: StepWho; kind: StepKind; title: string; required: boolean };

/** The starter plan (layer 1, from the SOP's phases); admins edit it. {name} is the new person's name. */
export const STARTER_PLAN: PlanStep[] = [
  { id: "read-handbook", day: 0, who: "person", kind: "read", title: "Read the Handbook: Overview", required: true },
  { id: "first-checkin", day: 0, who: "manager", kind: "meet", title: "First check-in with {name}", required: true },
  { id: "buddy-lunch", day: 1, who: "buddy", kind: "do", title: "Lunch with {name}", required: false },
  { id: "time-zone", day: 3, who: "person", kind: "do", title: "Add your time zone and working hours", required: true },
  { id: "hows-it-going", day: 30, who: "person", kind: "answer", title: "How’s it going?", required: true },
];

export const WHO_WORD: Record<StepWho, string> = { person: "New person", manager: "Line manager", buddy: "Buddy" };

/** Report 35.2 (B6.1b): a lab's New people plan — on by default; the manager is the person's Supervisor. */
export const LAB_STARTER_PLAN: PlanStep[] = [
  { id: "read-guide", day: 0, who: "person", kind: "read", title: "Read the lab guide: Welcome", required: true },
  { id: "safety", day: 0, who: "person", kind: "read", title: "Read Safety and training and sign off", required: true },
  { id: "accounts", day: 1, who: "person", kind: "do", title: "Set up your accounts, computing and data access", required: true },
  { id: "first-supervision", day: 3, who: "manager", kind: "meet", title: "First supervision meeting with {name}", required: true },
  { id: "reading-group", day: 7, who: "person", kind: "do", title: "Join the reading group", required: false },
  { id: "workspace", day: 7, who: "person", kind: "do", title: "Make your workspace from a template (Thesis or Project)", required: true },
  { id: "hows-it-going", day: 30, who: "person", kind: "answer", title: "How’s it going?", required: true },
];
export const starterPlanFor = (orgType: string | null | undefined) => (orgType === "research" ? LAB_STARTER_PLAN : STARTER_PLAN);
export const whoWords = (orgType: string | null | undefined): Record<StepWho, string> => (orgType === "research" ? { ...WHO_WORD, manager: "Supervisor" } : WHO_WORD);
/** Types whose people get a New people plan (company: when switched on; research: on unless switched off). */
export const ONBOARDING_TYPES = ["company", "research"] as const;
export const KIND_WORD: Record<StepKind, string> = { read: "Read", do: "Do", meet: "Meet", answer: "Answer" };

/** Phases (call: Before day 1 · Day 1 · Week 1 · Month 1 · Month 2 · Month 3), counted from the start date (day 0 = Day 1). */
export function phaseOf(day: number): string {
  if (day < 0) return "Before day 1";
  if (day === 0) return "Day 1";
  if (day < 7) return "Week 1";
  if (day < 30) return "Month 1";
  if (day < 60) return "Month 2";
  return "Month 3";
}
export const PHASES = ["Before day 1", "Day 1", "Week 1", "Month 1", "Month 2", "Month 3"] as const;

/** A step's due date: the start date plus its day offset (YYYY-MM-DD, UTC days). */
export const dueFor = (start: string, day: number) => new Date(Date.parse(`${start}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);

/** "Day 3" from the start date (Day 1 is the start date; before it, "Starts in N days"). */
export function dayLabel(start: string, today: string): string {
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  return d < 0 ? `Starts in ${-d} ${d === -1 ? "day" : "days"}` : `Day ${d + 1}`;
}

/** Onboarding complete when every required step is done (layer 5). */
export const onboardingDone = (steps: Array<{ required: boolean; done: boolean }>) => steps.length > 0 && steps.filter((s) => s.required).every((s) => s.done);

export function validPlan(plan: unknown): plan is PlanStep[] {
  return Array.isArray(plan) && plan.length <= 60 && plan.every((s) => s && typeof s === "object"
    && typeof (s as PlanStep).id === "string" && /^[a-z0-9-]{1,40}$/.test((s as PlanStep).id)
    && Number.isInteger((s as PlanStep).day) && (s as PlanStep).day >= -14 && (s as PlanStep).day <= 90
    && ["person", "manager", "buddy"].includes((s as PlanStep).who) && ["read", "do", "meet", "answer"].includes((s as PlanStep).kind)
    && typeof (s as PlanStep).title === "string" && (s as PlanStep).title.trim().length > 0 && (s as PlanStep).title.length <= 200 && typeof (s as PlanStep).required === "boolean")
    && new Set(plan.map((s) => (s as PlanStep).id)).size === plan.length;
}
