/**
 * Report 30.5 W4 (plan B1.6): exams, pure. An exam is an assignment with `exam` settings: a format, a window, a room,
 * what it covers and whether results are held until released. No per-student countdown timer (call 1); extra time
 * moves only that student's close (call 3); a clash warns, never blocks (call 5).
 */
export type ExamFormat = "in_person" | "timed" | "take_home";
export type ExamSettings = {
  format: ExamFormat;
  /** When it starts (in person, timed) or when the take-home is given out; ISO. */
  opensAt: string;
  /** When hand-in closes (timed, take-home) or the exam ends (in person); ISO. */
  closesAt: string;
  room: string | null;
  seats: string | null;
  covers: { units: string[]; outcomes: string[] };
  /** Hold results until released (on by default for exams). */
  hold: boolean;
  /** Set by Release results; held marks show from then. */
  releasedAt?: string | null;
};

export const EXAM_FORMATS: Record<ExamFormat, string> = { in_person: "In person", timed: "Timed online", take_home: "Take-home" };

export function readExam(settings: unknown): ExamSettings | null {
  const e = (settings as { exam?: Partial<ExamSettings> } | null)?.exam;
  if (!e || !(e.format === "in_person" || e.format === "timed" || e.format === "take_home")) return null;
  if (typeof e.opensAt !== "string" || typeof e.closesAt !== "string" || !(Date.parse(e.closesAt) > Date.parse(e.opensAt))) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string").slice(0, 40) : []);
  return {
    format: e.format, opensAt: e.opensAt, closesAt: e.closesAt,
    room: typeof e.room === "string" && e.room.trim() ? e.room.trim().slice(0, 80) : null,
    seats: typeof e.seats === "string" && e.seats.trim() ? e.seats.trim().slice(0, 120) : null,
    covers: { units: list(e.covers?.units), outcomes: list(e.covers?.outcomes) },
    hold: e.hold !== false,
    releasedAt: typeof e.releasedAt === "string" ? e.releasedAt : null,
  };
}

/** A timed paper stays locked on the server until it opens (call: "the paper is never sent before opening"). */
export const paperLocked = (exam: ExamSettings | null, now = Date.now()) => Boolean(exam && exam.format === "timed" && now < Date.parse(exam.opensAt));

/** This student's close: the exam's close plus their extra time (minutes). */
export const closeFor = (exam: ExamSettings, extraMinutes = 0) => new Date(Date.parse(exam.closesAt) + Math.max(0, extraMinutes) * 60_000);

export type ExamPhase = "before" | "open" | "closed";
export function examPhase(exam: ExamSettings, now = Date.now(), extraMinutes = 0): ExamPhase {
  if (now < Date.parse(exam.opensAt)) return "before";
  return now < closeFor(exam, extraMinutes).getTime() ? "open" : "closed";
}

/** "Paper opens Thu 10:00" · "Closes in 42 min" · "Closed" (layer 11). `fmt` writes a time in the reader's zone. */
export function examStateText(exam: ExamSettings, fmt: (d: Date) => string, now = Date.now(), extraMinutes = 0): string {
  const phase = examPhase(exam, now, extraMinutes);
  if (phase === "before") return exam.format === "timed" ? `Paper opens ${fmt(new Date(exam.opensAt))}` : exam.format === "take_home" ? `Given out ${fmt(new Date(exam.opensAt))}` : `Starts ${fmt(new Date(exam.opensAt))}`;
  if (phase === "closed") return "Closed";
  if (exam.format === "in_person") return "On now";
  const left = Math.ceil((closeFor(exam, extraMinutes).getTime() - now) / 60_000);
  return left < 120 ? `Closes in ${left} min` : `Closes ${fmt(closeFor(exam, extraMinutes))}`;
}

/** Held results stay hidden from students until Release results (layer 5). */
export const resultsHeld = (exam: ExamSettings | null) => Boolean(exam && exam.hold && !exam.releasedAt);

/** The window of two exams overlaps (clash check, call 5). */
export const overlaps = (a: { opensAt: string; closesAt: string }, b: { opensAt: string; closesAt: string }) =>
  Date.parse(a.opensAt) < Date.parse(b.closesAt) && Date.parse(b.opensAt) < Date.parse(a.closesAt);
