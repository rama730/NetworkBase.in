"use client";

import { readMentoringAction } from "@/app/actions/mentoring";
import { MentorsView } from "@/components/organizations/Mentoring";
import { readPathAction } from "@/app/actions/learning-path";
import { ProgressTable } from "@/components/workspaces/tabs/sprint/LearningPath";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteSectionAction, moveStudentAction, pickSectionAction, readReviewLoadAction, readSectionsAction, rebalanceReviewsAction, saveSectionAction, saveSectionSettingsAction, splitStudentsAction, type SectionRow } from "@/app/actions/sections";
import { readOrgMembersAction } from "@/app/actions/org-members";
import { messageUserInWindow } from "@/components/messages/message-user";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { meetsText } from "@/components/organizations/ClassHomeParts";
import { AttendanceView } from "@/components/organizations/Attendance";
import { CompletionView } from "@/components/organizations/Completion";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { SECTION_WORDS, type SectionSettings } from "@/lib/organizations/sections";
import { timeLabel } from "@/lib/organizations/zoned-time";
import { cn } from "@/lib/utils";

// Report 30.9 W8 (plan B1.3a): sections in a class — the Sections view, Split students, Your section, Settings.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const KIND: Record<SectionRow["kind"], string> = { lab: "Lab", tutorial: "Tutorial", lecture: "Lecture group", mentor: "Mentor group" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const key = (orgId: string) => ["class-sections", orgId] as const;
const useSections = (orgId: string) => useQuery({ queryKey: key(orgId), queryFn: () => readSectionsAction(orgId), staleTime: 15_000 });

/** A class's Members tab: Roster (today's) or Sections. */
export function ClassMembers({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [view, setView] = useState<"roster" | "sections" | "attendance" | "completion" | "progress" | "mentors">("roster");
  // B2.3a (report 31.5): staff see Mentors once Mentoring is on.
  const mentoring = useQuery({ queryKey: ["mentoring", orgId], queryFn: () => readMentoringAction(orgId), staleTime: 30_000 });
  const mentorsOn = mentoring.data?.success && mentoring.data.on && Boolean(mentoring.data.staff);
  // B2.2a (report 31.3 layer 4): a self-paced class adds Progress (learners × modules, pace, Stuck) for staff.
  const path = useQuery({ queryKey: ["learning-path", orgId], queryFn: () => readPathAction(orgId), staleTime: 15_000 });
  const selfPaced = path.data?.success && path.data.settings.pacing === "self" && path.data.seesProgress;
  return (
    <div>
      <div role="group" aria-label="Members view" className="mb-3 inline-flex rounded-md border border-border p-0.5 text-[12px]" data-testid="class-members-switch">
        {(["roster", "sections", "attendance", "completion", ...(selfPaced ? ["progress" as const] : []), ...(mentorsOn ? ["mentors" as const] : [])] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>
            {v === "roster" ? "Roster" : v === "sections" ? "Sections" : v === "attendance" ? "Attendance" : v === "completion" ? "Completion" : v === "progress" ? "Progress" : "Mentors"}
          </button>
        ))}
      </div>
      {view === "sections" ? <SectionsView orgId={orgId} /> : view === "attendance" ? <AttendanceView orgId={orgId} /> : view === "completion" ? <CompletionView orgId={orgId} /> : view === "progress" ? <ProgressTable projectId={orgId} /> : view === "mentors" ? <MentorsView orgId={orgId} /> : children}
    </div>
  );
}

export function SectionsView({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useSections(orgId);
  const [editing, setEditing] = useState<SectionRow | "new" | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [removing, setRemoving] = useState<SectionRow | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading sections…</p>;
  const data = q.data;
  if (!data?.success) return <ErrorNotice what="Sections" onRetry={() => void q.refetch()} />;
  const word = data.settings.word;
  const teacher = data.role === "teacher" && data.canWrite;
  const refresh = () => client.invalidateQueries({ queryKey: key(orgId) });
  const total = data.sections.reduce((n, s) => n + s.students.length, 0);
  return (
    <div className="space-y-4" data-testid="sections-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="nb-section-title">{word}s <span className="nb-meta font-mono">{data.sections.length} · {total} students</span></h2>
        {teacher ? <span className="flex gap-2">
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!data.sections.length} onClick={() => setSplitting(true)}>Split students…</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setEditing("new")}>+ New {word.toLowerCase()}</button>
        </span> : null}
      </div>
      {data.sections.length === 0 ? (
        <EmptyState figure="person" title={`No ${word.toLowerCase()}s yet`} description={`A ${word.toLowerCase()} is a group of students with its own TA, times and room. Classes without them work as today.`} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={`${word}s`}>
          {data.sections.map((s) => (
            <li key={s.id} className="rounded-md border border-border bg-card p-4 text-[13px]" data-testid="section-card" aria-label={`${s.name}, ${s.students.length} students`}>
              <p className="flex items-baseline justify-between gap-2"><span className="font-semibold text-foreground">{s.name} · {KIND[s.kind]}</span>
                {s.seatsLeft != null ? <span className="nb-meta font-mono">{s.seatsLeft} seats left</span> : null}</p>
              <p className="mt-1 text-muted-foreground">{s.meets.length ? meetsText(s.meets) : "No times yet"}{s.room ? ` · ${s.room}` : ""}</p>
              <p className="mt-1">{s.tas.length ? `TA ${s.tas.map((t) => t.name).join(", ")}` : <span className="text-[var(--status-warning)]">No TA · reviews go to the teacher</span>} · <span className="font-mono">{s.students.length} students</span></p>
              <p className="mt-2 flex flex-wrap gap-3">
                <button type="button" className={LINK} aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>Open<span className="sr-only"> {s.name}</span></button>
                {teacher ? <button type="button" className={LINK} onClick={() => setEditing(s)}>Edit<span className="sr-only"> {s.name}</span></button> : null}
                {teacher ? <button type="button" className={LINK} onClick={() => { setMoveTo(""); setRemoving(s); }}>Remove<span className="sr-only"> {s.name}</span></button> : null}
              </p>
              {open === s.id ? (
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-border pt-2">
                  {s.students.map((st) => (
                    <li key={st.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{st.name}</span>
                      {teacher && data.sections.length > 1 ? (
                        <select aria-label={`Move ${st.name} to`} className="nb-select h-7 w-[130px] text-[12px]" value=""
                          onChange={(e) => void moveStudentAction(orgId, st.id, e.target.value).then((r) => { if (!r.success) toast.error(r.error); else { toast(`${st.name} moved`); void refresh(); } })}>
                          <option value="">Move to…</option>
                          {data.sections.filter((x) => x.id !== s.id && x.kind === s.kind).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      ) : null}
                    </li>
                  ))}
                  {s.students.length === 0 ? <li className="text-muted-foreground">No students yet.</li> : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data.unplaced.length ? (
        <p className="text-[13px]" data-testid="sections-unplaced"><span className="font-medium">Not in a {word.toLowerCase()} · {data.unplaced.length}</span>
          <span className="text-muted-foreground"> {data.unplaced.slice(0, 5).map((u) => u.name).join(", ")}{data.unplaced.length > 5 ? "…" : ""}</span>
          {teacher && data.sections.length ? <> · <button type="button" className={LINK} onClick={() => setSplitting(true)}>Split students…</button></> : null}</p>
      ) : null}
      {data.sections.some((x) => x.tas.length) ? <ReviewLoad orgId={orgId} teacher={teacher} /> : null}
      {editing ? <SectionDialog orgId={orgId} word={word} section={editing === "new" ? null : editing} onClose={(saved) => { setEditing(null); if (saved) void refresh(); }} /> : null}
      {splitting ? <SplitDialog orgId={orgId} word={word} kinds={[...new Set(data.sections.map((s) => s.kind))]} onClose={(done) => { setSplitting(false); if (done) void refresh(); }} /> : null}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => { if (!o) setRemoving(null); }} title={`Remove ${removing?.name ?? ""}?`}
        description={removing?.students.length ? `Move its ${removing.students.length} students to another ${word.toLowerCase()} first.` : "Nobody is in it."} confirmLabel="Remove" variant="destructive" size="wide"
        onConfirm={async () => { const r = await deleteSectionAction(orgId, removing!.id, moveTo || null); if (!r.success) throw new Error(r.error); toast("Removed"); await refresh(); }}>
        {removing?.students.length ? (
          <label className="flex flex-col gap-1 text-[13px]"><span className="font-medium">Move them to</span>
            <select className="nb-select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">Choose…</option>
              {data.sections.filter((x) => x.id !== removing.id && x.kind === removing.kind).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function SectionDialog({ orgId, word, section, onClose }: { orgId: string; word: string; section: SectionRow | null; onClose: (saved: boolean) => void }) {
  const admins = useQuery({ queryKey: ["org-members", orgId, "admins"], queryFn: () => readOrgMembersAction(orgId), staleTime: 60_000 });
  const tas = admins.data?.success ? admins.data.rows.filter((r) => r.role === "admin") : [];
  const [d, setD] = useState({ name: section?.name ?? "", kind: section?.kind ?? "lab" as SectionRow["kind"], meets: section?.meets ?? [], room: section?.room ?? "",
    seatLimit: section?.seatLimit ? String(section.seatLimit) : "", taIds: section?.tas.map((t) => t.id) ?? [] as string[] });
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(false); }} title={section ? `Edit ${section.name}` : `New ${word.toLowerCase()}`} confirmLabel="Save" size="wide"
      onConfirm={async () => {
        const r = await saveSectionAction(orgId, { id: section?.id, name: d.name, kind: d.kind, meets: d.meets, room: d.room || null, officeHours: section?.officeHours ?? null,
          seatLimit: d.seatLimit ? Number(d.seatLimit) : null, taIds: d.taIds });
        if (!r.success) throw new Error(r.error);
        toast(section ? "Saved" : `${word} made`);
        onClose(true);
      }}>
      <div className="space-y-3 text-[13px]" data-testid="section-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className="font-medium">Name</span><Input value={d.name} maxLength={60} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Section A" /></label>
          <label className="flex flex-col gap-1"><span className="font-medium">Kind</span>
            <select className="nb-select" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as SectionRow["kind"] })}>
              {(Object.keys(KIND) as SectionRow["kind"][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="space-y-2"><legend className="font-medium">Meets</legend>
          {d.meets.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select aria-label={`Session ${i + 1} day`} className="nb-select w-[100px]" value={m.day} onChange={(e) => setD({ ...d, meets: d.meets.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })}>
                {DAYS.map((n, k) => <option key={n} value={k}>{n}</option>)}
              </select>
              <Input type="time" aria-label={`Session ${i + 1} starts`} value={m.start} onChange={(e) => setD({ ...d, meets: d.meets.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} className="w-[120px]" />
              <Input type="time" aria-label={`Session ${i + 1} ends`} value={m.end} onChange={(e) => setD({ ...d, meets: d.meets.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} className="w-[120px]" />
              <button type="button" className={LINK} onClick={() => setD({ ...d, meets: d.meets.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> session {i + 1}</span></button>
            </div>
          ))}
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setD({ ...d, meets: [...d.meets, { day: 3, start: "14:00", end: "16:00" }] })}>Add a time</button>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className="font-medium">Room</span><Input value={d.room} maxLength={80} onChange={(e) => setD({ ...d, room: e.target.value })} placeholder="Lab 3" /></label>
          <label className="flex flex-col gap-1"><span className="font-medium">Seat limit</span><Input type="number" min={1} max={2000} value={d.seatLimit} onChange={(e) => setD({ ...d, seatLimit: e.target.value })} placeholder="None" /></label>
        </div>
        <fieldset className="space-y-1"><legend className="font-medium">TAs</legend>
          {tas.length ? tas.map((t) => (
            <label key={t.userId} className="flex items-center gap-2"><input type="checkbox" className="nb-checkbox" checked={d.taIds.includes(t.userId)}
              onChange={(e) => setD({ ...d, taIds: e.target.checked ? [...d.taIds, t.userId] : d.taIds.filter((x) => x !== t.userId) })} />{t.name}</label>
          )) : <p className="text-muted-foreground">No TAs in this class yet. Make someone a TA in Roster first.</p>}
        </fieldset>
      </div>
    </ConfirmDialog>
  );
}

function SplitDialog({ orgId, word, kinds, onClose }: { orgId: string; word: string; kinds: SectionRow["kind"][]; onClose: (done: boolean) => void }) {
  const [kind, setKind] = useState<SectionRow["kind"]>(kinds[0] ?? "lab");
  const [method, setMethod] = useState<"even" | "random" | "surname">("even");
  const [everyone, setEveryone] = useState(false);
  const preview = useQuery({ queryKey: ["section-split", orgId, kind, method, everyone], queryFn: () => splitStudentsAction(orgId, { kind, method, everyone, apply: false }), staleTime: 0 });
  const p = preview.data?.success ? preview.data : null;
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(false); }} title="Split students" description={`Nothing changes until you apply. Students get one ${word.toLowerCase()} of each kind.`} confirmLabel="Apply" size="wide"
      onConfirm={async () => { const r = await splitStudentsAction(orgId, { kind, method, everyone, apply: true }); if (!r.success) throw new Error(r.error); toast("Students placed. They’re told."); onClose(true); }}>
      <div className="space-y-3 text-[13px]" data-testid="split-dialog">
        <div className="flex flex-wrap gap-3">
          {kinds.length > 1 ? <select aria-label="Kind" className="nb-select w-[160px]" value={kind} onChange={(e) => setKind(e.target.value as SectionRow["kind"])}>{kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select> : null}
          <select aria-label="How to split" className="nb-select w-[200px]" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="even">Evenly, by name</option><option value="random">Randomly</option><option value="surname">By surname range</option>
          </select>
          <label className="flex items-center gap-2"><input type="checkbox" className="nb-checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />Everyone, not only students without one</label>
        </div>
        {p ? (
          <table className="w-full text-[13px]">
            <caption className="sr-only">Preview</caption>
            <thead><tr className="text-left text-muted-foreground"><th scope="col" className="py-1">{word}</th><th scope="col" className="py-1">Students</th></tr></thead>
            <tbody>{p.preview.map((s) => <tr key={s.id} className="border-t border-border"><th scope="row" className="py-1 text-left font-medium">{s.name}</th><td className="py-1"><span className="font-mono">{s.students.length}</span> · {s.students.slice(0, 4).join(", ")}{s.students.length > 4 ? "…" : ""}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-muted-foreground">{preview.data && !preview.data.success ? preview.data.error : "Working out the split…"}</p>}
        {p?.unplaced ? <p className="text-[var(--status-warning)]">{p.unplaced} don’t fit the seat limits and stay unplaced.</p> : null}
      </div>
    </ConfirmDialog>
  );
}

/** Students: Your section card (About and Overview); with self-pick on and no section yet, the sections to pick from. */
export function YourSectionCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useSections(orgId);
  const data = q.data?.success ? q.data : null;
  if (!data || data.role !== "student") return null;
  const mine = data.sections.filter((s) => s.mine);
  const word = data.settings.word;
  if (!mine.length && !data.settings.selfPick) return null;
  return (
    <OrgCard title={`Your ${word.toLowerCase()}`} testId="your-section">
      {mine.length ? mine.map((s) => (
        <div key={s.id} className="space-y-1 text-[13px]">
          <p className="font-medium text-foreground">{s.name} · {KIND[s.kind]}{s.meets.length ? <span className="font-normal text-muted-foreground"> · {meetsText(s.meets)}</span> : null}{s.room ? <span className="font-normal text-muted-foreground"> · {s.room}</span> : null}</p>
          {s.tas.map((t) => <p key={t.id}>TA {t.name} · <Link href={`/messages?userId=${t.id}`} onClick={(e) => messageUserInWindow(t.id, e)} className="nb-link">Message</Link></p>)}
          {s.officeHours ? <p className="text-muted-foreground">Office hours {s.officeHours.days.map((d) => DAYS[d]).join(" ")} {timeLabel(s.officeHours.start)}–{timeLabel(s.officeHours.end)}</p> : null}
          <p className="text-muted-foreground">{s.students.length} in your {word.toLowerCase()}</p>
        </div>
      )) : (
        <ul className="space-y-1 text-[13px]" aria-label={`${word}s to pick`}>
          {data.sections.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span>{s.name} · {KIND[s.kind]}{s.meets.length ? ` · ${meetsText(s.meets)}` : ""}</span>
              <span className="flex items-center gap-2">{s.seatsLeft != null ? <span className="nb-meta font-mono">{s.seatsLeft} seats left</span> : null}
                <button type="button" className={FORM_SECONDARY_CLASS} disabled={s.seatsLeft === 0}
                  onClick={() => void pickSectionAction(orgId, s.id).then((r) => { if (!r.success) toast.error(r.error); else { toast(`You’re in ${s.name}`); void client.invalidateQueries({ queryKey: key(orgId) }); } })}>Pick<span className="sr-only"> {s.name}</span></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </OrgCard>
  );
}

/** Settings → Sections (the teacher). */
export function SectionSettingsCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useSections(orgId);
  const data = q.data?.success ? q.data : null;
  const [draft, setDraft] = useState<SectionSettings | null>(null);
  if (!data || data.role !== "teacher") return null;
  const s = draft ?? data.settings;
  const save = async () => {
    const r = await saveSectionSettingsAction(orgId, s);
    if (!r.success) return void toast.error(r.error);
    toast.success("Section settings saved");
    setDraft(null);
    await client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <section id="project-settings-sections" data-project-settings-section className="space-y-6">
      <SettingsCard title="Sections" headingLevel={2} description="Groups of students with their own TA, times and room. Make and split them in Members, under Sections.">
        <div className="space-y-4 text-[13px]" data-testid="section-settings">
          <label className="flex flex-col gap-1.5"><span className="font-medium">Call them</span>
            <select className="nb-select w-[200px]" value={s.word} onChange={(e) => setDraft({ ...s, word: e.target.value as SectionSettings["word"] })}>{SECTION_WORDS.map((w) => <option key={w}>{w}</option>)}</select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" className="nb-checkbox" checked={s.taOnlyOwn} onChange={(e) => setDraft({ ...s, taOnlyOwn: e.target.checked })} />TAs work only with their section (they still see every name)</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="nb-checkbox" checked={s.selfPick} onChange={(e) => setDraft({ ...s, selfPick: e.target.checked })} />Students pick their own section, while seats are left</label>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save section settings</button>
        </div>
      </SettingsCard>
    </section>
  );
}

/** Review load per TA (call 9: flagged above 1.5× the average) and Rebalance… with a preview. */
function ReviewLoad({ orgId, teacher }: { orgId: string; teacher: boolean }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["review-load", orgId], queryFn: () => readReviewLoadAction(orgId), staleTime: 15_000 });
  const [asking, setAsking] = useState(false);
  const preview = useQuery({ queryKey: ["rebalance", orgId], queryFn: () => rebalanceReviewsAction(orgId, false), enabled: asking, staleTime: 0 });
  const data = q.data?.success ? q.data : null;
  if (!data?.load.length) return null;
  const p = preview.data?.success ? preview.data : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" data-testid="review-load">
      <span className="font-medium">Review load</span>
      {data.load.map((l) => (
        <span key={l.userId} className="flex items-center gap-1">{l.name} <span className="font-mono">{l.toReview}</span>{l.over ? <StatusBadge state="at_risk">Over</StatusBadge> : null}</span>
      ))}
      {teacher && data.load.length > 1 ? <button type="button" className={LINK} onClick={() => setAsking(true)}>Rebalance…</button> : null}
      <ConfirmDialog open={asking} onOpenChange={setAsking} title="Rebalance reviews" confirmLabel="Rebalance" size="wide"
        description="Hand-ins not reviewed yet move from TAs above the average to TAs below it. Reviewed work stays."
        onConfirm={async () => {
          const r = await rebalanceReviewsAction(orgId, true);
          if (!r.success) throw new Error(r.error);
          toast(r.moves ? `${r.moves} hand-ins moved` : "Already balanced");
          await Promise.all([client.invalidateQueries({ queryKey: ["review-load", orgId] }), client.invalidateQueries({ queryKey: ["rebalance", orgId] })]);
        }}>
        <div className="text-[13px]" data-testid="rebalance-preview">
          {!p ? <p className="text-muted-foreground">{preview.data && !preview.data.success ? preview.data.error : "Working it out…"}</p>
            : p.moves === 0 ? <p>Already balanced. Nothing moves.</p>
              : <ul className="space-y-1">{p.summary.map((m) => <li key={`${m.from}-${m.to}`}><span className="font-mono">{m.count}</span> from {m.from} to {m.to}</li>)}</ul>}
        </div>
      </ConfirmDialog>
    </div>
  );
}
