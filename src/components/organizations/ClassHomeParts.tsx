"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { changeSessionAction, readClassHomeAction, saveClassDetailsAction, type ClassHome } from "@/app/actions/class-home";
import { createDocFile } from "@/components/organizations/OrgDocParts";
import { DateTimeField } from "@/components/organizations/DateTimeField";
import { OrgCard } from "@/components/organizations/org-ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BookOpenText, CalendarClock, CalendarRange, Clock, Hash, Link2, MapPin, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RailSection } from "@/components/ui/rail-section";
import { messageUserInWindow } from "@/components/messages/message-user";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { DEFAULT_SHOW, type ClassDetails, type Session } from "@/lib/organizations/class-sessions";
import { describeLocal, timeLabel } from "@/lib/organizations/zoned-time";
import { templateBody, templateById, templateFileName } from "@/lib/workflows/doc-templates";

// Report 30.2 W1 (plan B1.1): Class details, Syllabus, This term and the Next class line.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const useClassHome = (orgId: string) => useQuery({ queryKey: ["class-home", orgId], queryFn: () => readClassHomeAction(orgId), staleTime: 30_000 });
const range = (start: string, end: string) => `${timeLabel(start)}–${timeLabel(end)}`;
const dayRange = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso)) : "…");

/** "Tue Thu 10:30 AM–12:00 PM": meets grouped by time. */
export function meetsText(meets: ClassDetails["meets"]) {
  const byTime = new Map<string, number[]>();
  for (const m of meets) byTime.set(`${m.start}|${m.end}`, [...(byTime.get(`${m.start}|${m.end}`) ?? []), m.day]);
  return [...byTime.entries()].map(([k, days]) => { const [s, e] = k.split("|"); return `${days.sort().map((d) => DAYS[d]).join(" ")} ${range(s!, e!)}`; }).join(" · ");
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 text-muted-foreground [&>svg]:size-4" aria-hidden="true">{icon}</span>
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

/** About's rail: the Class details card, as a description list. */
export function ClassDetailsRail({ orgId, settingsHref }: { orgId: string; settingsHref: string }) {
  const q = useClassHome(orgId);
  const data = q.data?.success ? q.data : null;
  if (!data) return null;
  const d = data.details;
  if (!d && !data.canEditDetails) return null;
  return (
    <RailSection title="Class details" action={data.canEditDetails ? <Link href={settingsHref} className="nb-link text-[13px]">Edit</Link> : undefined}>
      {!d ? <Link href={settingsHref} className={LINK}>Add class details</Link> : (
        <dl data-testid="class-details">
          {d.courseCode ? <Row icon={<Hash />} label="Course code"><span className="font-mono">{d.courseCode}</span></Row> : null}
          {d.meets.length ? <Row icon={<CalendarClock />} label="Meets">{meetsText(d.meets)}</Row> : null}
          {d.room ? <Row icon={<MapPin />} label="Room">{d.room}</Row> : null}
          {d.onlineLink ? <Row icon={<Link2 />} label="Online"><a href={d.onlineLink} rel="noopener noreferrer nofollow" target="_blank" className="nb-link">Join online</a></Row> : null}
          {d.officeHours ? <Row icon={<Clock />} label="Office hours">Office hours {d.officeHours.days.map((x) => DAYS[x]).join(" ")} {range(d.officeHours.start, d.officeHours.end)}{d.officeHours.place ? ` · ${d.officeHours.place}` : ""}</Row> : null}
          {data.teacher ? (
            <Row icon={<UserRound />} label="Teacher">
              <span className="flex flex-wrap items-center gap-2">{data.teacher.name}
                {data.role !== "visitor" && data.role !== "teacher" ? <Link href={`/messages?userId=${data.teacher.id}`} onClick={(e) => messageUserInWindow(data.teacher!.id, e)} className="nb-link">Message</Link> : null}
              </span>
            </Row>
          ) : null}
          {data.term?.start && data.term.end ? <Row icon={<CalendarRange />} label="Term"><time dateTime={data.term.start}>{dayRange(data.term.start)}</time>–<time dateTime={data.term.end}>{dayRange(data.term.end)}</time>{data.ended ? " · Ended" : ""}</Row> : null}
          {d.credits != null ? <Row icon={<BookOpenText />} label="Credits">{d.credits} credits</Row> : null}
        </dl>
      )}
    </RailSection>
  );
}

/** About's main column: the Syllabus card and This term. */
export function SyllabusAndTerm({ orgId, base }: { orgId: string; base: string }) {
  const q = useClassHome(orgId);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const data = q.data?.success ? q.data : null;
  if (!data) return null;
  const s = data.syllabus;
  const addSyllabus = async () => {
    const t = templateById("syllabus")!;
    setBusy(true);
    try {
      const made = await createDocFile(orgId, templateFileName(t.name, ""), templateBody(t, ""));
      const { setDocTemplateAction } = await import("@/app/actions/workspace/doc");
      await setDocTemplateAction(orgId, { docSlug: made.slug, template: "syllabus" });
      toast.success("Syllabus added. Fill it in, then publish it.");
      await client.invalidateQueries({ queryKey: ["class-home", orgId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t add the syllabus.");
    } finally {
      setBusy(false);
    }
  };
  const units = data.units;
  return (
    <>
      {s || data.canEditDetails ? (
        <OrgCard title="Syllabus" testId="class-syllabus" action={s ? <Link href={`${base}?tab=readme&doc=${encodeURIComponent(s.slug)}`} className="nb-link text-[13px]">Open</Link> : undefined}>
          {s ? (
            <div className="space-y-1.5 text-[13px]">
              <p className="font-medium text-foreground">{s.title}{units.length ? <span className="nb-meta ml-2 font-mono">{units.length} {units.length === 1 ? "unit" : "units"}</span> : null}</p>
              {s.firstParagraph ? <p className="text-muted-foreground">{s.firstParagraph}</p> : <p className="text-muted-foreground">{s.published ? "" : "Not published yet. Students see it once you publish it."}</p>}
            </div>
          ) : <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void addSyllabus()}>Add a syllabus</button>}
        </OrgCard>
      ) : null}
      {units.length ? (
        <OrgCard title="This term" testId="class-this-term" action={<Link href={`${base}?tab=sprints`} className="nb-link text-[13px]">Term plan</Link>}>
          <ul className="divide-y divide-border text-[13px]">
            {units.map((u) => (
              <li key={u.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{u.name}</span>
                <span className="nb-meta shrink-0 font-mono">
                  {u.start ? `${dayRange(u.start)}–${dayRange(u.end)}` : "No dates"}
                  {u.status === "completed" ? " · Done" : u.status === "active" ? " · Now" : ""}
                </span>
              </li>
            ))}
          </ul>
        </OrgCard>
      ) : null}
    </>
  );
}

function sessionWords(s: Session, zone: string | null) {
  const when = describeLocal(s.start, zone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (s.status === "cancelled") return { lead: "Cancelled", text: when.text, yours: null };
  if (s.status === "moved") return { lead: "Moved to", text: when.text, yours: when.yourTime };
  return { lead: "Next class", text: when.text, yours: when.yourTime };
}

/** Overview, top of Today: the Next class line and Office hours today; teachers and TAs cancel, move or restore it. */
export function ClassNextLine({ orgId }: { orgId: string }) {
  const q = useClassHome(orgId);
  const client = useQueryClient();
  const [ask, setAsk] = useState<"cancel" | "move" | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const data: ClassHome | null = q.data?.success ? q.data : null;
  if (!data || data.role === "visitor") return null;
  const n = data.next;
  const oh = data.officeHoursToday;
  if (!n && !oh) {
    return data.canEditDetails && data.details?.meets.length && !(data.term?.start && data.term.end)
      ? <p className="text-[13px] text-muted-foreground" data-testid="class-next">Set the term dates to show the next class.</p> : null;
  }
  const change = async (c: "cancel" | "restore" | { moveTo: string }) => {
    const r = await changeSessionAction(orgId, { key: n!.key, change: c });
    if (!r.success) throw new Error(r.error);
    toast(c === "cancel" ? "Class cancelled. The class is told." : c === "restore" ? "Class is on again" : "Class moved. The class is told.");
    await client.invalidateQueries({ queryKey: ["class-home", orgId] });
  };
  const w = n ? sessionWords(n, data.zone) : null;
  return (
    <div className="space-y-1 text-[13px]" data-testid="class-next">
      {n && w ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-foreground">{w.lead}</span>
          <time dateTime={n.start} className="font-mono">{w.text}</time>
          {w.yours ? <span className="text-muted-foreground">({w.yours} your time)</span> : null}
          {n.status !== "cancelled" && data.details?.room ? <span className="text-muted-foreground">· {data.details.room}</span> : null}
          {data.canChangeSessions ? (n.status === "on"
            ? <><button type="button" className={LINK} onClick={() => setAsk("cancel")}>Cancel this class</button><button type="button" className={LINK} onClick={() => { setMoveTo(n.start); setAsk("move"); }}>Move this class</button></>
            : <button type="button" className={LINK} onClick={() => void change("restore").catch((e: Error) => toast.error(e.message))}>Restore</button>) : null}
        </p>
      ) : null}
      {oh ? <p className="flex items-center gap-2 text-muted-foreground"><Clock className="size-4" aria-hidden="true" />Office hours today · {range(oh.start, oh.end)}{oh.place ? ` · ${oh.place}` : ""}</p> : null}
      <ConfirmDialog open={ask === "cancel"} onOpenChange={(o) => { if (!o) setAsk(null); }} title="Cancel this class?" description={`${w?.text ?? ""}. Everyone in the class is told.`} confirmLabel="Cancel the class" cancelLabel="Keep it"
        onConfirm={() => change("cancel")} />
      <ConfirmDialog open={ask === "move"} onOpenChange={(o) => { if (!o) setAsk(null); }} title="Move this class" description="Pick the new day and time. Everyone in the class is told." confirmLabel="Move the class" size="wide"
        onConfirm={() => change({ moveTo })}>
        <DateTimeField value={moveTo} onChange={setMoveTo} timeZone={data.zone} summary="Moves to" aria-label="New day and time" />
      </ConfirmDialog>
    </div>
  );
}

type Draft = Omit<ClassDetails, "credits"> & { credits: string };
const blank = (): Draft => ({ courseCode: "", meets: [], room: "", onlineLink: "", officeHours: null, credits: "", breaks: [], show: { ...DEFAULT_SHOW } });

/** Settings → Class details (the teacher; everyone else sees it read-only on About). */
export function ClassDetailsSettings({ orgId }: { orgId: string }) {
  const q = useClassHome(orgId);
  const client = useQueryClient();
  const data = q.data?.success ? q.data : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tell, setTell] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data || !data.canEditDetails) return null;
  const d: Draft = draft ?? (data.details ? { ...data.details, courseCode: data.details.courseCode ?? "", room: data.details.room ?? "", onlineLink: data.details.onlineLink ?? "", credits: data.details.credits == null ? "" : String(data.details.credits) } : blank());
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const meetAt = (i: number, patch: Partial<Draft["meets"][number]>) => set({ meets: d.meets.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const save = async () => {
    setBusy(true);
    const r = await saveClassDetailsAction(orgId, { ...d, courseCode: d.courseCode || null, room: d.room || null, onlineLink: d.onlineLink || null, credits: d.credits === "" ? null : Number(d.credits) }, tell)
      .finally(() => setBusy(false));
    if (!r.success) return void toast.error(r.error);
    toast.success(tell ? "Saved. The class is told." : "Class details saved");
    setDraft(null);
    setTell(false);
    await client.invalidateQueries({ queryKey: ["class-home", orgId] });
  };
  const time = (value: string, onChange: (v: string) => void, label: string) => <Input type="time" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-[120px]" />;
  const show = (key: keyof Draft["show"], label: string) => (
    <label className="flex items-center gap-2 text-[12px] text-muted-foreground"><input type="checkbox" className="nb-checkbox" checked={d.show[key]} onChange={(e) => set({ show: { ...d.show, [key]: e.target.checked } })} />Show {label} to visitors</label>
  );
  return (
    <section id="project-settings-class-details" data-project-settings-section className="space-y-6">
      <SettingsCard title="Class details" headingLevel={2} description="When and where the class meets, and office hours. Shown on About; students see them all, visitors only what you switch on.">
        <div className="space-y-5" data-testid="class-details-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Course code</span><Input value={d.courseCode ?? ""} maxLength={20} onChange={(e) => set({ courseCode: e.target.value })} placeholder="CS 301" />{show("courseCode", "the course code")}</label>
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Credits</span><Input type="number" min={0} max={60} value={d.credits} onChange={(e) => set({ credits: e.target.value })} /></label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">Meets</legend>
            {d.meets.map((m, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select aria-label={`Class ${i + 1} day`} className="nb-select w-[110px]" value={m.day} onChange={(e) => meetAt(i, { day: Number(e.target.value) })}>
                  {DAYS.map((name, n) => <option key={name} value={n}>{name}</option>)}
                </select>
                {time(m.start, (v) => meetAt(i, { start: v }), `Class ${i + 1} starts`)}
                {time(m.end, (v) => meetAt(i, { end: v }), `Class ${i + 1} ends`)}
                <button type="button" className={LINK} onClick={() => set({ meets: d.meets.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> class {i + 1}</span></button>
              </div>
            ))}
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => set({ meets: [...d.meets, { day: 2, start: "10:30", end: "12:00" }] })}>Add a class time</button>
            {show("meets", "when it meets")}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Room</span><Input value={d.room ?? ""} maxLength={80} onChange={(e) => set({ room: e.target.value })} placeholder="LH-2 · 204" />{show("room", "the room")}</label>
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Online link</span><Input value={d.onlineLink ?? ""} maxLength={300} onChange={(e) => set({ onlineLink: e.target.value })} placeholder="https://" /><span className="text-[12px] text-muted-foreground">Members only. NetworkBase never opens it.</span></label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">Office hours</legend>
            {d.officeHours ? (
              <div className="flex flex-wrap items-center gap-2">
                {DAYS.map((name, n) => (
                  <label key={name} className="flex items-center gap-1 text-[13px]"><input type="checkbox" className="nb-checkbox" checked={d.officeHours!.days.includes(n)}
                    onChange={(e) => set({ officeHours: { ...d.officeHours!, days: e.target.checked ? [...d.officeHours!.days, n] : d.officeHours!.days.filter((x) => x !== n) } })} />{name}</label>
                ))}
                {time(d.officeHours.start, (v) => set({ officeHours: { ...d.officeHours!, start: v } }), "Office hours start")}
                {time(d.officeHours.end, (v) => set({ officeHours: { ...d.officeHours!, end: v } }), "Office hours end")}
                <Input aria-label="Office hours place" value={d.officeHours.place ?? ""} maxLength={80} onChange={(e) => set({ officeHours: { ...d.officeHours!, place: e.target.value || null } })} placeholder="Room 12, or a link" className="w-[200px]" />
                <button type="button" className={LINK} onClick={() => set({ officeHours: null })}>Remove office hours</button>
              </div>
            ) : <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => set({ officeHours: { days: [3], start: "15:00", end: "16:00", place: null } })}>Add office hours</button>}
            {show("officeHours", "office hours")}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">Breaks</legend>
            <p className="text-[12px] text-muted-foreground">No classes on these days.</p>
            {d.breaks.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input aria-label={`Break ${i + 1} name`} value={b.name} maxLength={60} onChange={(e) => set({ breaks: d.breaks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="w-[180px]" />
                <Input type="date" aria-label={`Break ${i + 1} first day`} value={b.start} onChange={(e) => set({ breaks: d.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} className="w-[160px]" />
                <Input type="date" aria-label={`Break ${i + 1} last day`} value={b.end} onChange={(e) => set({ breaks: d.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} className="w-[160px]" />
                <button type="button" className={LINK} onClick={() => set({ breaks: d.breaks.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> break {i + 1}</span></button>
              </div>
            ))}
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => set({ breaks: [...d.breaks, { name: "Break", start: "", end: "" }] })}>Add a break</button>
          </fieldset>
          {show("term", "the term dates")}
          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void save()}>Save class details</button>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="nb-checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} />Tell the class</label>
          </div>
        </div>
      </SettingsCard>
    </section>
  );
}
