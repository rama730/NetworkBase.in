"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { exportRegisterAction, readAttendanceAction, saveAttendanceAction, saveAttendanceSettingsAction } from "@/app/actions/attendance";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { saveBlob } from "@/lib/download";
import { toast } from "@/lib/feedback";
import type { AttendanceSettings, AttendanceStatus } from "@/lib/organizations/attendance";
import { describeLocal } from "@/lib/organizations/zoned-time";
import { cn } from "@/lib/utils";

// Report 30.7 W6 (plan B1.4a): the Attendance grid, Take attendance, the student's line and Settings → Attendance.
const LETTER: Record<AttendanceStatus, string> = { present: "P", late: "L", absent: "A", excused: "E" };
const WORD: Record<AttendanceStatus, string> = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" };
const STATES: AttendanceStatus[] = ["present", "late", "absent", "excused"];
const key = (orgId: string) => ["attendance", orgId] as const;
const useAttendance = (orgId: string) => useQuery({ queryKey: key(orgId), queryFn: () => readAttendanceAction(orgId), staleTime: 15_000 });
const short = (start: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${start.slice(0, 10)}T00:00:00Z`));

export function AttendanceView({ orgId }: { orgId: string }) {
  const q = useAttendance(orgId);
  const [taking, setTaking] = useState<string | null>(null);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading attendance…</p>;
  const data = q.data;
  if (!data?.success) return <ErrorNotice what="Attendance" onRetry={() => void q.refetch()} />;
  if (!data.settings.on) return <EmptyState figure="person" title="Attendance is off" description={data.role === "teacher" ? "Turn it on in Settings, under Attendance." : "The teacher turns it on in Settings."} />;
  const staff = data.role !== "student";
  const cols = data.sessions.slice(-10);
  const takeKey = data.today?.key ?? data.sessions.at(-1)?.key ?? null;
  const exportCsv = async () => {
    const r = await exportRegisterAction(orgId);
    if (!r.success) return void toast.error(r.error);
    saveBlob(new Blob([r.csv], { type: "text/csv;charset=utf-8" }), `register-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  return (
    <div className="space-y-4" data-testid="attendance-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="nb-section-title">Attendance{data.settings.minimum ? <span className="nb-meta font-mono"> · minimum {data.settings.minimum}%</span> : null}</h2>
        {staff ? <span className="flex gap-2">
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!data.sessions.length} onClick={() => void exportCsv()}>Export register</button>
          {takeKey && data.canWrite ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setTaking(takeKey)}>Take attendance</button> : null}
        </span> : null}
      </div>
      {data.sessions.length === 0 ? <p className="text-[13px] text-muted-foreground">No sessions held yet. Sessions come from Class details and the term dates.</p> : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[560px] text-[13px]">
            <caption className="sr-only">Attendance by student and session</caption>
            <thead className="border-b border-border text-[12px] text-muted-foreground">
              <tr><th scope="col" className="sticky left-0 bg-card px-3 py-2 text-left font-medium">Student</th>
                {cols.map((s) => <th key={s.key} scope="col" className="px-2 py-2 font-mono font-medium"><button type="button" className="hover:underline" disabled={!staff || !data.canWrite} onClick={() => setTaking(s.key)} aria-label={`Take attendance for ${short(s.start)}`}>{short(s.start)}</button></th>)}
                <th scope="col" className="px-3 py-2 text-right font-medium">Attendance</th></tr>
            </thead>
            <tbody>
              {data.students.map((st) => (
                <tr key={st.id} className="border-b border-border" data-testid="attendance-row">
                  <th scope="row" className="sticky left-0 bg-card px-3 py-2 text-left font-medium">{st.name}</th>
                  {cols.map((s) => { const v = st.records[s.key] as AttendanceStatus | undefined; return (
                    <td key={s.key} className="px-2 py-2 text-center font-mono" title={v ? WORD[v] : "Not taken"}><span aria-label={v ? WORD[v] : "Not taken"}>{v ? LETTER[v] : "·"}</span></td>
                  ); })}
                  <td className="px-3 py-2 text-right"><span className="font-mono">{st.percent == null ? "—" : `${st.percent}%`}</span>{st.below ? <StatusBadge state="at_risk" className="ml-2">Below {data.settings.minimum}%</StatusBadge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">P Present · L Late · A Absent · E Excused · · not taken</p>
        </div>
      )}
      {taking ? <TakeAttendance orgId={orgId} sessionKey={taking} onClose={() => setTaking(null)} /> : null}
    </div>
  );
}

/** Take attendance (call 5): opens unmarked, Mark all present, change the exceptions, Save with a live count. */
export function TakeAttendance({ orgId, sessionKey, onClose }: { orgId: string; sessionKey: string; onClose: () => void }) {
  const client = useQueryClient();
  const q = useAttendance(orgId);
  const data = q.data?.success ? q.data : null;
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [filled, setFilled] = useState(false);
  if (data && !filled) {
    // An already-taken session opens with its marks; a new one opens unmarked.
    setMarks(Object.fromEntries(data.students.flatMap((s) => (s.records[sessionKey] ? [[s.id, s.records[sessionKey] as AttendanceStatus]] : []))));
    setFilled(true);
  }
  const counts = STATES.map((st) => `${Object.values(marks).filter((m) => m === st).length} ${WORD[st].toLowerCase()}`).join(", ");
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={`Take attendance · ${describeLocal(sessionKey, null, null).text}`} size="wide"
      confirmLabel={`Save · ${counts}`}
      onConfirm={async () => {
        const r = await saveAttendanceAction(orgId, sessionKey, Object.entries(marks).map(([userId, status]) => ({ userId, status })));
        if (!r.success) throw new Error(r.error);
        toast(`Saved for ${r.saved}`);
        await client.invalidateQueries({ queryKey: key(orgId) });
        onClose();
      }}>
      <div className="space-y-2 text-[13px]" data-testid="take-attendance">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMarks(Object.fromEntries((data?.students ?? []).map((s) => [s.id, "present" as const])))}>Mark all present</button>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {(data?.students ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5">
              <span className="font-medium">{s.name}{s.notes[sessionKey] ? <span className="ml-2 font-normal text-muted-foreground">Notified: {s.notes[sessionKey]}</span> : null}</span>
              <span role="radiogroup" aria-label={`${s.name}`} className="flex gap-1">
                {STATES.map((st) => (
                  <button key={st} type="button" role="radio" aria-checked={marks[s.id] === st} onClick={() => setMarks({ ...marks, [s.id]: st })}
                    className={cn("nb-touch-target rounded-sm border border-border px-2.5 py-1 text-[12px]", marks[s.id] === st ? "bg-foreground font-semibold text-background" : "bg-card text-foreground hover:bg-muted")}>{WORD[st]}</button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ConfirmDialog>
  );
}

/** A student's own line (Overview): %, the minimum and "you can miss N more classes". */
export function YourAttendanceLine({ orgId }: { orgId: string }) {
  const q = useAttendance(orgId);
  const data = q.data?.success ? q.data : null;
  if (!data || data.role !== "student" || !data.settings.on) return null;
  const me = data.students[0];
  if (!me) return null;
  return (
    <OrgCard title="Your attendance" testId="your-attendance">
      <p className="text-[13px]"><span className="font-mono text-[15px] font-semibold">{me.percent == null ? "—" : `${me.percent}%`}</span>
        {data.settings.minimum ? <span className="text-muted-foreground"> · minimum {data.settings.minimum}%</span> : null}
        {me.canMiss != null ? <span className="text-muted-foreground"> · {me.canMiss === 0 ? "don’t miss another class" : `you can miss ${me.canMiss} more ${me.canMiss === 1 ? "class" : "classes"}`}</span> : null}</p>
      {me.below ? <p className="mt-1 text-[13px] text-[var(--status-danger)]">Below the minimum.</p> : null}
    </OrgCard>
  );
}

/** Settings → Attendance (the Teacher). */
export function AttendanceSettingsCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useAttendance(orgId);
  const data = q.data?.success ? q.data : null;
  const [draft, setDraft] = useState<AttendanceSettings | null>(null);
  if (!data || data.role !== "teacher") return null;
  const s = draft ?? data.settings;
  const save = async () => {
    const r = await saveAttendanceSettingsAction(orgId, s);
    if (!r.success) return void toast.error(r.error);
    toast.success("Attendance settings saved");
    setDraft(null);
    await client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <section id="project-settings-attendance" data-project-settings-section className="space-y-6">
      <SettingsCard title="Attendance" headingLevel={2} description="Present, Late, Absent or Excused for each class session. Students see only their own.">
        <div className="space-y-3 text-[13px]" data-testid="attendance-settings">
          <label className="flex items-center gap-2"><input type="checkbox" className="nb-checkbox" checked={s.on} onChange={(e) => setDraft({ ...s, on: e.target.checked })} />Take attendance in this class</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="nb-checkbox" checked={s.lateCountsPresent} onChange={(e) => setDraft({ ...s, lateCountsPresent: e.target.checked })} />Late counts as present</label>
          <label className="flex items-center gap-2">Late after <Input type="number" min={0} max={120} aria-label="Late after, minutes" value={s.lateAfterMinutes} onChange={(e) => setDraft({ ...s, lateAfterMinutes: Number(e.target.value) || 0 })} className="w-[80px]" /> minutes</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="nb-checkbox" checked={s.absenceNotes} onChange={(e) => setDraft({ ...s, absenceNotes: e.target.checked })} />Students can send an absence note</label>
          <label className="flex items-center gap-2">Minimum <Input type="number" min={1} max={100} aria-label="Minimum attendance, percent" value={s.minimum ?? ""} placeholder="None" onChange={(e) => setDraft({ ...s, minimum: e.target.value ? Number(e.target.value) : null })} className="w-[80px]" />%</label>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save attendance settings</button>
        </div>
      </SettingsCard>
    </section>
  );
}
