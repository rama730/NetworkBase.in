"use client";

import { SchoolYearSettings } from "@/components/organizations/SchoolYear";
import { TeachingSettings } from "@/components/organizations/Curriculum";
import { SCHOOL_KINDS, type SchoolKind } from "@/lib/organizations/school-kind";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { decideClassRequestAction, joinInstitutionAction, makeInstitutionAction, readClassInstitutionAction, readInstitutionClassesAction, saveDepartmentsAction, saveSchoolAttendanceMinimumAction, saveSchoolKindAction, saveSchoolExamWeeksAction, setClassDepartmentAction, unlinkClassAction, type Department, type InstitutionClass } from "@/app/actions/institutions";
import { readOrgMembersAction } from "@/app/actions/org-members";
import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { classCounts } from "@/lib/organizations/school-rules";

const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const href = (o: { slug: string | null; id: string }) => `/org/${encodeURIComponent(o.slug ?? o.id)}`;
type ClassSide = Extract<Awaited<ReturnType<typeof readClassInstitutionAction>>, { success: true }>;
type SchoolSide = Extract<Awaited<ReturnType<typeof readInstitutionClassesAction>>, { success: true }>;

/**
 * Report 29.2 (plan B0.1), Settings → Organization level. A school sees its classes as counts only and decides
 * requests; a class joins or leaves a school; an empty Education organization can become a school.
 */
export function OrgSchoolCard({ orgId, isSchool }: { orgId: string; isSchool: boolean }) {
  const [school, setSchool] = useState<SchoolSide | null>(null);
  const [cls, setCls] = useState<ClassSide | null>(null);
  const [pick, setPick] = useState("");
  const [confirm, setConfirm] = useState<"make" | "leave" | null>(null);
  const refresh = useCallback(async () => {
    if (isSchool) {
      const r = await readInstitutionClassesAction(orgId);
      if (r.success && r.isAdmin) setSchool(r);
    } else {
      const r = await readClassInstitutionAction(orgId);
      if (r.success) setCls(r);
    }
  }, [orgId, isSchool]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (p: Promise<{ success: true } | { success: false; error: string }>, done: string) => {
    const r = await p;
    if (!r.success) throw new Error(r.error);
    toast(done);
    await refresh();
  };

  if (isSchool) {
    if (!school) return null;
    return (
      <section id="project-settings-org-school" data-project-settings-section className="space-y-6">
        <SettingsCard title="Classes" headingLevel={2} description="Classes that are part of this school. You see counts only, never students’ work.">
          {school.requests.length > 0 ? (
            <div className="divide-y divide-border" data-testid="school-requests">
              {school.requests.map((r) => (
                <SettingsRow key={r.id} title={r.title} description="Wants to join this school."
                  right={<span className="flex gap-2">
                    <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(decideClassRequestAction(orgId, r.id, true), `${r.title} joined`).catch((e: Error) => toast.error(e.message))}>Approve<span className="sr-only"> {r.title}</span></button>
                    <button type="button" className={LINK} onClick={() => void run(decideClassRequestAction(orgId, r.id, false), "Request declined").catch((e: Error) => toast.error(e.message))}>Decline<span className="sr-only"> {r.title}</span></button>
                  </span>} />
              ))}
            </div>
          ) : null}
          {school.classes.length === 0 ? (
            <p className="nb-compact text-muted-foreground" data-testid="school-classes-none">No classes yet. A class joins from its own Settings with Join a school.</p>
          ) : (
            <div className="divide-y divide-border" data-testid="school-classes">
              {school.classes.map((c: InstitutionClass) => (
                <SettingsRow key={c.id} title={<Link href={href(c)} className="hover:underline">{c.title}</Link>}
                  description={c.teacher ? `Teacher ${c.teacher}` : undefined}
                  meta={<span className="font-mono">{classCounts(c)}</span>}
                  right={<span className="flex items-center gap-3">
                    {school.departments.length ? (
                      <select aria-label={`Department of ${c.title}`} className="nb-select w-[160px]" value={c.department ?? ""}
                        onChange={(e) => void run(setClassDepartmentAction(orgId, c.id, e.target.value || null), "Department saved").catch((err: Error) => toast.error(err.message))}>
                        <option value="">No department</option>
                        {school.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    ) : null}
                    <button type="button" className={LINK} onClick={() => void run(unlinkClassAction(c.id), `${c.title} removed from the school`).catch((e: Error) => toast.error(e.message))}>Remove<span className="sr-only"> {c.title}</span></button>
                  </span>} />
              ))}
            </div>
          )}
        </SettingsCard>
        <DepartmentsCard schoolId={orgId} departments={school.departments} onSaved={refresh} />
        <SchoolYearSettings orgId={orgId} />
        <TeachingSettings schoolId={orgId} />
        <SchoolKindCard schoolId={orgId} value={school.schoolKind} onSaved={refresh} />
        <SchoolMinimum schoolId={orgId} value={school.attendanceMinimum} onSaved={refresh} />
        <SchoolExamWeeks schoolId={orgId} value={school.examWeeks ?? []} onSaved={refresh} />
      </section>
    );
  }

  if (!cls || (!cls.eligible && !cls.institution)) return null;
  const schools = cls.schools;
  return (
    <section id="project-settings-org-school" data-project-settings-section className="space-y-6">
      <SettingsCard title="School" headingLevel={2} description="A class can be part of one school. The school sees counts only: members, open assignments and the review backlog.">
        {cls.institution ? (
          <SettingsRow title={<>Part of <Link href={href(cls.institution)} className="text-primary hover:underline">{cls.institution.title}</Link></>}
            right={<button type="button" className={LINK} onClick={() => setConfirm("leave")}>Leave the school</button>} />
        ) : cls.pending ? (
          <SettingsRow title={`Asked to join ${cls.pending.title}`} description="Its admins approve or decline."
            right={<button type="button" className={LINK} onClick={() => void run(unlinkClassAction(orgId), "Request cancelled").catch((e: Error) => toast.error(e.message))}>Cancel request</button>} />
        ) : (
          <SettingsRow title="Join a school" description={schools.length ? "Pick a school you belong to. Its admins approve, unless you’re one of them." : "Join a school’s organization first; it then shows here."}>
            {schools.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select aria-label="School" className="nb-select min-w-[220px] flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Choose a school</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
                <button type="button" className={FORM_SECONDARY_CLASS} disabled={!pick}
                  onClick={() => void joinInstitutionAction(orgId, pick).then(async (r) => {
                    if (!r.success) { toast.error(r.error); return; }
                    toast(r.outcome === "joined" ? "Joined the school" : "Request sent");
                    setPick("");
                    await refresh();
                  })}>Join</button>
              </div>
            ) : null}
          </SettingsRow>
        )}
        {cls.canBecomeSchool ? (
          <SettingsRow title="Make this a school" description="A school holds classes instead of workspaces. Classes join it; it sees their counts, never their work."
            right={<button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setConfirm("make")}>Make a school</button>} />
        ) : null}
      </SettingsCard>
      <ConfirmDialog open={confirm === "make"} onOpenChange={(open) => { if (!open) setConfirm(null); }} title="Make this a school?"
        description="It will hold classes, not workspaces. Classes join it from their own Settings." confirmLabel="Make a school"
        onConfirm={async () => { await run(makeInstitutionAction(orgId), "This is a school now"); window.location.reload(); }} />
      <ConfirmDialog open={confirm === "leave"} onOpenChange={(open) => { if (!open) setConfirm(null); }} title="Leave the school?"
        description="The school stops seeing this class’s counts. Nothing in the class changes." confirmLabel="Leave the school"
        onConfirm={() => run(unlinkClassAction(orgId), "Left the school")} />
    </section>
  );
}

/** Settings → Departments (B0.2): names, and a head of department picked from the school's members. */
function DepartmentsCard({ schoolId, departments, onSaved }: { schoolId: string; departments: Department[]; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState(departments);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(departments), [departments]);
  const members = useQuery({ queryKey: ["org-members", schoolId, "heads"], queryFn: () => readOrgMembersAction(schoolId), staleTime: 60_000 });
  const people = members.data?.success ? members.data.rows : [];
  const set = (i: number, patch: Partial<Department>) => setRows((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const save = async () => {
    setBusy(true);
    const r = await saveDepartmentsAction(schoolId, rows).finally(() => setBusy(false));
    if (!r.success) return void toast.error(r.error);
    toast("Departments saved");
    await onSaved();
  };
  return (
    <SettingsCard title="Departments" headingLevel={2} description="A label on each class. A head of department sees their department’s classes with the same counts you see, nothing more.">
      <div className="space-y-3" data-testid="school-departments">
        {rows.length === 0 ? <p className="nb-compact text-muted-foreground">No departments yet.</p> : null}
        {rows.map((d, i) => (
          <div key={d.id || i} className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Department ${i + 1} name`} value={d.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} className="min-w-[180px] flex-1" />
            <select aria-label={`Head of ${d.name || `department ${i + 1}`}`} className="nb-select w-[200px]" value={d.heads[0] ?? ""} onChange={(e) => set(i, { heads: e.target.value ? [e.target.value] : [] })}>
              <option value="">No head</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
            <button type="button" className={LINK} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>Remove<span className="sr-only"> {d.name}</span></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setRows((cur) => [...cur, { id: "", name: "", heads: [] }])}>Add department</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void save()}>Save departments</button>
        </div>
      </div>
    </SettingsCard>
  );
}

/** B2.1d (report 31.2 calls 1–2): the school's kind sets new classes' starting words; classes already here keep theirs. */
function SchoolKindCard({ schoolId, value, onSaved }: { schoolId: string; value: SchoolKind | null; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<string>(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const save = async () => {
    const r = await saveSchoolKindAction(schoolId, (draft || null) as SchoolKind | null);
    if (!r.success) return void toast.error(r.error);
    toast.success("Kind saved. New classes start with its words.");
    await onSaved();
  };
  return (
    <SettingsCard title="Kind" headingLevel={2} description="Sets the words and joining new classes start with. Each class can change them; classes already here keep theirs.">
      <div className="flex flex-wrap items-center gap-3 text-[13px]" data-testid="school-kind">
        <select className="nb-select" aria-label="School kind" value={draft} onChange={(e) => setDraft(e.target.value)}>
          <option value="">Not set</option>
          {(Object.keys(SCHOOL_KINDS) as SchoolKind[]).map((k) => <option key={k} value={k}>{SCHOOL_KINDS[k]}</option>)}
        </select>
        {draft === "coaching" ? <span className="text-muted-foreground">Instructor · Mentor · Learner, Modules, joining by approval</span> : null}
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save kind</button>
      </div>
    </SettingsCard>
  );
}

/** B1.4b (report 30.7): the school's attendance minimum, locked in every class ("Set by"). Empty means each class decides. */
function SchoolMinimum({ schoolId, value, onSaved }: { schoolId: string; value: number | null; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const save = async () => {
    const r = await saveSchoolAttendanceMinimumAction(schoolId, draft ? Number(draft) : null);
    if (!r.success) return void toast.error(r.error);
    toast.success(draft ? `Minimum ${draft}% set for every class` : "Each class sets its own minimum");
    await onSaved();
  };
  return (
    <SettingsCard title="Attendance" headingLevel={2} description="A minimum every class in the school follows. You see each class’s average and how many are below it, never names.">
      <div className="flex flex-wrap items-center gap-3 text-[13px]" data-testid="school-attendance-minimum">
        <label className="flex items-center gap-2">Minimum <Input type="number" min={1} max={100} aria-label="School attendance minimum, percent" value={draft} placeholder="None" onChange={(e) => setDraft(e.target.value)} className="w-[80px]" />%</label>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save minimum</button>
      </div>
    </SettingsCard>
  );
}

/** B1.6d (report 30.5): the school's exam weeks; every class skips its sessions then unless it turns that off. */
function SchoolExamWeeks({ schoolId, value, onSaved }: { schoolId: string; value: Array<{ name: string; start: string; end: string }>; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState(value);
  useEffect(() => setRows(value), [value]);
  const save = async () => {
    const r = await saveSchoolExamWeeksAction(schoolId, rows);
    if (!r.success) return void toast.error(r.error);
    toast.success(rows.length ? "Exam weeks set for every class" : "No exam weeks");
    await onSaved();
  };
  const set = (i: number, patch: Partial<{ name: string; start: string; end: string }>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <SettingsCard title="Exam weeks" headingLevel={2} description="Every class has no classes then, unless it turns that off in its own Settings, under Exams.">
      <div className="space-y-2 text-[13px]" data-testid="school-exam-weeks">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Exam week ${i + 1} name`} value={r.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} placeholder="Midterms" className="w-[160px]" />
            <Input type="date" aria-label={`Exam week ${i + 1} starts`} value={r.start} onChange={(e) => set(i, { start: e.target.value })} className="w-auto font-mono" />
            <Input type="date" aria-label={`Exam week ${i + 1} ends`} value={r.end} min={r.start || undefined} onChange={(e) => set(i, { end: e.target.value })} className="w-auto font-mono" />
            <button type="button" className="nb-touch-target text-[13px] font-medium text-primary hover:underline" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>Remove<span className="sr-only"> exam week {i + 1}</span></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setRows((cur) => [...cur, { name: "", start: "", end: "" }])}>Add exam week</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save exam weeks</button>
        </div>
      </div>
    </SettingsCard>
  );
}
