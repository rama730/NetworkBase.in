/**
 * Report 30.7 W6 (plan B1.4): attendance rules, pure. A record is per session (W1's session key) and student.
 */
export type AttendanceStatus = "present" | "late" | "absent" | "excused";
export type AttendanceSettings = { on: boolean; lateCountsPresent: boolean; lateAfterMinutes: number; absenceNotes: boolean; minimum: number | null };

export function readAttendanceSettings(orgSettings: unknown): AttendanceSettings {
  const raw = ((orgSettings as { attendance?: Record<string, unknown> } | null)?.attendance ?? {}) as Record<string, unknown>;
  const min = raw.minimum;
  return {
    // Call 1: on by default where a minimum is set; otherwise the teacher turns it on.
    on: raw.on === true || (raw.on === undefined && typeof min === "number"),
    lateCountsPresent: raw.lateCountsPresent !== false,
    lateAfterMinutes: typeof raw.lateAfterMinutes === "number" && raw.lateAfterMinutes >= 0 && raw.lateAfterMinutes <= 120 ? raw.lateAfterMinutes : 10,
    absenceNotes: raw.absenceNotes !== false,
    minimum: typeof min === "number" && min > 0 && min <= 100 ? min : null,
  };
}

/**
 * A student's attendance over the sessions held since they joined: Present (and Late, when it counts) ÷ held
 * sessions that weren't excused. Not taken counts as neither. Null when nothing counts yet ("—").
 */
export function attendancePercent(input: { held: string[]; records: Map<string, AttendanceStatus>; joinedDay: string | null; lateCountsPresent: boolean }) {
  const counted = input.held.filter((key) => !input.joinedDay || key.slice(0, 10) >= input.joinedDay);
  let present = 0, total = 0, absent = 0;
  for (const key of counted) {
    const s = input.records.get(key);
    if (!s || s === "excused") continue;
    total += 1;
    if (s === "present" || (s === "late" && input.lateCountsPresent)) present += 1;
    else absent += 1;
  }
  return { percent: total ? Math.round((present / total) * 100) : null, present, absent, total };
}

/**
 * "You can miss N more classes": with the minimum, how many of the term's remaining sessions can go unattended and
 * still end at or above it (assuming the rest are attended). 0 at worst.
 */
export function canMissMore(input: { present: number; total: number; remaining: number; minimum: number }) {
  const all = input.total + input.remaining;
  if (all === 0) return null;
  const needed = Math.ceil((input.minimum / 100) * all);
  return Math.max(0, input.present + input.remaining - needed);
}

/** Call: staff change a record within 7 days of its session; after that only a Teacher, and it's logged. */
export const editableByStaff = (sessionKey: string, now = new Date()) => now.getTime() - Date.parse(`${sessionKey}:00Z`) <= 7 * 86_400_000 + 14 * 3_600_000;

/** The register: one row per student, one column per session, the letters P / L / A / E (blank when not taken). */
export function registerCsv(sessions: string[], students: Array<{ name: string; records: Map<string, AttendanceStatus>; percent: number | null }>) {
  const letter: Record<AttendanceStatus, string> = { present: "P", late: "L", absent: "A", excused: "E" };
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [["Student", ...sessions.map((s) => s.replace("T", " ")), "Attendance %"]];
  for (const st of students) rows.push([st.name, ...sessions.map((s) => { const r = st.records.get(s); return r ? letter[r] : ""; }), st.percent == null ? "" : String(st.percent)]);
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
