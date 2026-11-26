"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Library } from "lucide-react";

import { suggestSourceAction } from "@/app/actions/lab-reading-group";
import { addSourcesAction, editSourceAction, readLibraryAction, readLibraryCardAction, readSourceAction, removeSourceAction, saveLabNoteAction, setMyReadingAction,
  setSourceThemeAction, type LibraryRow } from "@/app/actions/lab-library";
import { LabReadingGroup } from "@/components/organizations/LabReadingGroup";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { NOTE_SECTIONS, parseRis, READING_STATES, readingWord, type LabSourceInput, type NoteSection, type ReadingState } from "@/lib/organizations/lab-library";
import { parseBibtex, sourceKey } from "@/lib/workflows/literature";

// Report 35.4 (plan B6.4a, R3): the lab's Library at Documents → Library (?tab=docs&library=all): All, Themes, My reading; a source
// opens in place with its signed lab notes, my private reading and its themes. Nothing counts or ranks people's reading.
const key = (orgId: string, tab: string, q: string) => ["lab-library", orgId, tab, q] as const;
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
type Tab = "all" | "themes" | "mine" | "group";
const TABS: Record<Tab, string> = { all: "All", themes: "Themes", mine: "My reading", group: "Reading group" };
const avail = (v: boolean | null, what: string) => (v === null ? null : `${what} ${v ? "available" : "not available"}`);

export function LabLibrary({ orgId }: { orgId: string }) {
  // B6.4b: notices link to ?library=group.
  const [tab, setTab] = useState<Tab>(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("library") === "group" ? "group" : "all"));
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<"form" | "paste" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const lib = useQuery({ queryKey: key(orgId, tab, q), queryFn: () => readLibraryAction(orgId, { q, mine: tab === "mine" }), staleTime: 30_000 });
  const d = lib.data?.success ? lib.data : null;
  if (lib.isPending) return <p role="status" className="nb-waiting p-5 text-[13px] text-muted-foreground"><PixelBeat />Loading the library…</p>;
  if (!d) return <p className="p-5 text-[13px] text-muted-foreground">The Library is for the lab’s members.</p>;
  return (
    <section aria-labelledby="lab-library-title" className="mx-auto w-full max-w-5xl space-y-3 p-4 text-[13px] sm:p-5" data-testid="lab-library">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lab-library-title" className="nb-section-title flex items-center gap-2 text-foreground"><Library className="size-4" aria-hidden="true" />Library <span className="nb-meta">{d.total} {d.total === 1 ? "source" : "sources"}</span></h2>
        {d.writer && !adding ? <span className="flex gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAdding("paste")}>Paste BibTeX or RIS</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setAdding("form")}>+ Add</button></span> : null}
      </header>
      {adding ? <AddSources orgId={orgId} mode={adding} known={d.rows} onDone={() => setAdding(null)} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Library views" className="flex gap-1">{(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} className="nb-tag h-7" onClick={() => setTab(t)}>{TABS[t]}</button>))}</div>
        {tab === "all" || tab === "mine" ? <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and authors" aria-label="Search the library" className="ml-auto w-[240px]" /> : null}
      </div>
      {tab === "group" ? <LabReadingGroup orgId={orgId} /> : tab === "themes" ? <Themes rows={d.themeRows} /> : d.rows.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">{(tab === "mine" ? sortMine(d.rows) : d.rows).map((r) => (
          <li key={r.id} data-testid="lab-source">
            <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="min-w-0 flex-1"><span className="font-medium">{r.title}</span>
                <span className="block text-muted-foreground">{[r.authors?.split(";")[0]?.trim(), r.year, r.venue].filter(Boolean).join(" · ")}</span></span>
              {r.themes.map((t) => <StatusBadge key={t.theme} state="neutral">{t.theme}{t.disagrees ? " · Disagrees" : ""}</StatusBadge>)}
              <span className="text-muted-foreground">{r.notesBy.length ? `Lab notes by ${r.notesBy.join(", ")}` : "No lab notes"}</span>
              {r.myState ? <StatusBadge state={r.myState === "read" ? "done" : r.myState === "reading" ? "active" : "draft"}>{readingWord(r.myState, r.iWroteNotes)}</StatusBadge> : null}
            </button>
            {open === r.id ? <SourcePanel orgId={orgId} id={r.id} onGone={() => setOpen(null)} /> : null}
          </li>))}</ul>
      ) : <p className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">{tab === "mine" ? "Nothing on your reading list yet. Open a source and pick To read." : q ? "No sources match." : "No sources yet. Add your lab’s key papers: paste BibTeX or RIS."}</p>}
      {d.more && tab !== "group" && tab !== "themes" ? <p className="text-muted-foreground">Showing the newest 200. Search to find older ones.</p> : null}
    </section>
  );
}

const ORDER: ReadingState[] = ["to_read", "reading", "read"];
const sortMine = (rows: LibraryRow[]) => [...rows].sort((a, b) => ORDER.indexOf(a.myState ?? "to_read") - ORDER.indexOf(b.myState ?? "to_read"));

function Themes({ rows }: { rows: Array<{ theme: string; count: number; thin: boolean; disagrees: number }> }) {
  if (!rows.length) return <p className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">No themes yet. The PI or a Researcher sets the lab’s themes in Settings, under Lab.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border" data-testid="lab-themes">{rows.map((t) => (
      <li key={t.theme} className="flex flex-wrap items-center gap-2 px-3 py-2"><span className="font-medium">{t.theme}</span>
        <span className="font-mono text-muted-foreground">{t.count} {t.count === 1 ? "source" : "sources"}</span>
        {t.thin ? <StatusBadge state="at_risk">Thin</StatusBadge> : null}
        {t.disagrees ? <span className="text-muted-foreground">{t.disagrees} marked Disagrees</span> : null}</li>))}</ul>
  );
}

function SourcePanel({ orgId, id, onGone }: { orgId: string; id: string; onGone: () => void }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["lab-source", orgId, id], queryFn: () => readSourceAction(orgId, id) });
  const [editing, setEditing] = useState(false);
  const d = q.data?.success ? q.data : null;
  const refresh = () => { void q.refetch(); void client.invalidateQueries({ queryKey: ["lab-library", orgId] }); };
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  if (!d) return <p role="status" className="nb-waiting px-3 pb-3 text-muted-foreground"><PixelBeat />Loading the source…</p>;
  const s = d.source;
  const notes = new Map(d.notes.map((n) => [n.section, n]));
  return (
    <div className="space-y-3 border-t border-border bg-muted px-3 py-3" data-testid="lab-source-panel">
      {editing ? <SourceForm initial={{ title: s.title, authors: s.authors, year: s.year, venue: s.venue, link: s.link, doi: s.doi }} code={s.code} data={s.data}
        onSave={(v) => void run(editSourceAction(orgId, id, v), "Source saved").then(() => setEditing(false))} onCancel={() => setEditing(false)} /> : (
        <div className="space-y-1">
          <p>{s.authors ?? "Authors not given"}{s.year ? ` · ${s.year}` : ""}{s.venue ? ` · ${s.venue}` : ""}</p>
          <p className="flex flex-wrap gap-3">{s.link ? <a className="nb-link" href={s.link} target="_blank" rel="noreferrer noopener">Link</a> : null}{s.doi ? <span className="font-mono">DOI {s.doi}</span> : null}
            {[avail(s.code, "Code"), avail(s.data, "Data")].filter(Boolean).map((x) => <span key={x}>{x}</span>)}</p>
          <p className="text-muted-foreground">Added by {s.added_by_name ?? "someone"}{d.citedBy.length ? ` · Linked from ${d.citedBy.map((c) => c.title).join(", ")}` : ""}
            {d.sessions.length ? ` · Reading group ${d.sessions.map((x) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(x.at))).join(", ")}` : ""}</p>
          {d.writer ? <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={d.suggested} disabled={d.suggested && !d.suggestedByMe && !d.admin}
            onChange={(e) => void run(suggestSourceAction(orgId, id, e.target.checked), e.target.checked ? "Suggested for the reading group" : "Suggestion taken back")} />Suggest for reading group</label> : null}
          {d.canEdit ? <span className="flex gap-3"><button type="button" className="nb-link" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="nb-link" onClick={() => void safe(removeSourceAction(orgId, id)).then((r) => { if (!r.success) return void toast.error(r.error); toast.success("Removed from the library"); onGone(); refresh(); })}>Remove</button></span> : null}
        </div>)}
      <MyReading orgId={orgId} id={id} mine={d.mine} onSaved={refresh} />
      <fieldset className="space-y-2"><legend className="font-medium">Lab notes</legend>
        {(Object.keys(NOTE_SECTIONS) as NoteSection[]).map((sec) => <NoteRow key={sec} section={sec} note={notes.get(sec) ?? null} canWrite={d.writer} onSave={(body) => run(saveLabNoteAction(orgId, id, { section: sec, body }), "Lab note saved")} />)}
      </fieldset>
      {d.labThemes.length ? <fieldset className="space-y-1"><legend className="font-medium">Themes</legend>
        {d.labThemes.map((t) => <ThemeRow key={t} theme={t} link={d.themes.find((x) => x.theme === t) ?? null} canWrite={d.writer} onSave={(v) => run(setSourceThemeAction(orgId, id, { theme: t, ...v }), "Themes saved")} />)}
      </fieldset> : null}
    </div>
  );
}

function MyReading({ orgId, id, mine, onSaved }: { orgId: string; id: string; mine: { state: ReadingState; note: string } | null; onSaved: () => void }) {
  const [state, setState] = useState<ReadingState | "">(mine?.state ?? "");
  const [note, setNote] = useState(mine?.note ?? "");
  const save = async () => {
    const r = await safe(setMyReadingAction(orgId, id, { state: state || null, note: state ? note : "" }));
    if (!r.success) return void toast.error(r.error);
    toast.success(state ? "Your reading saved" : "Off your reading list");
    onSaved();
  };
  return (
    <fieldset className="space-y-1.5" data-testid="lab-my-reading"><legend className="font-medium">My reading <span className="font-normal text-muted-foreground">(only you see this)</span></legend>
      <span className="flex flex-wrap items-center gap-2">
        <select className="nb-select" aria-label="My reading state" value={state} onChange={(e) => setState(e.target.value as ReadingState | "")}>
          <option value="">Not on my list</option>{(Object.keys(READING_STATES) as ReadingState[]).map((s) => <option key={s} value={s}>{READING_STATES[s]}</option>)}</select>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save()}>Save</button>
      </span>
      {state ? <textarea className="nb-textarea w-full text-[13px]" rows={2} maxLength={5000} aria-label="My private note" placeholder="Private note" value={note} onChange={(e) => setNote(e.target.value)} /> : null}
    </fieldset>
  );
}

function NoteRow({ section, note, canWrite, onSave }: { section: NoteSection; note: { body: string; author: string | null; at: string } | null; canWrite: boolean; onSave: (body: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note?.body ?? "");
  return (
    <div className="space-y-1" data-testid={`lab-note-${section}`}>
      <p className="flex flex-wrap items-baseline gap-2"><span className="font-medium">{NOTE_SECTIONS[section]}</span>
        {note ? <span className="text-muted-foreground">by {note.author ?? "a former member"}</span> : null}
        {canWrite && !editing ? <button type="button" className="nb-link" onClick={() => { setBody(note?.body ?? ""); setEditing(true); }}>{note ? "Edit" : "Write"}<span className="sr-only"> {NOTE_SECTIONS[section]}</span></button> : null}</p>
      {editing ? <span className="flex flex-col gap-1.5">
        <textarea className="nb-textarea w-full text-[13px]" rows={3} maxLength={5000} aria-label={NOTE_SECTIONS[section]} value={body} onChange={(e) => setBody(e.target.value)} />
        <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void onSave(body).then(() => setEditing(false))}>Save</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing(false)}>Cancel</button></span></span>
        : note ? <p className="whitespace-pre-wrap">{note.body}</p> : null}
    </div>
  );
}

function ThemeRow({ theme, link, canWrite, onSave }: { theme: string; link: { disagrees: boolean; why: string } | null; canWrite: boolean; onSave: (v: { on: boolean; disagrees: boolean; why: string }) => Promise<void> }) {
  const [why, setWhy] = useState(link?.why ?? "");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" disabled={!canWrite} checked={Boolean(link)} onChange={(e) => void onSave({ on: e.target.checked, disagrees: false, why: "" })} />{theme}</label>
      {link ? <label className="flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" className="nb-check" disabled={!canWrite} checked={link.disagrees}
        onChange={(e) => void onSave({ on: true, disagrees: e.target.checked, why })} />Disagrees<span className="sr-only"> within {theme}</span></label> : null}
      {link?.disagrees ? <Input value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} onBlur={() => why !== link.why && void onSave({ on: true, disagrees: true, why })} aria-label={`Why it disagrees within ${theme}`} placeholder="Why" className="h-7 w-[260px]" /> : null}
    </span>
  );
}

const BLANK: LabSourceInput = { title: "", authors: null, year: null, venue: null, link: null, doi: null };

function SourceForm({ initial, code, data, onSave, onCancel }: { initial: LabSourceInput; code?: boolean | null; data?: boolean | null; onSave: (v: LabSourceInput & { code: boolean | null; data: boolean | null }) => void; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const [c, setC] = useState(code ?? null);
  const [dt, setDt] = useState(data ?? null);
  const tri = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
  const fromTri = (v: string) => (v === "" ? null : v === "yes");
  return (
    <fieldset className="space-y-2" data-testid="lab-source-form">
      <label className="flex flex-col">Title<Input value={f.title} maxLength={500} onChange={(e) => setF({ ...f, title: e.target.value })} className="mt-1" /></label>
      <span className="flex flex-wrap gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col">Authors<Input value={f.authors ?? ""} maxLength={1000} onChange={(e) => setF({ ...f, authors: e.target.value || null })} placeholder="Rao; Lin" className="mt-1" /></label>
        <label className="flex flex-col">Year<Input type="number" min={1000} max={3000} value={f.year ?? ""} onChange={(e) => setF({ ...f, year: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-[100px] font-mono" /></label>
        <label className="flex min-w-[160px] flex-col">Venue<Input value={f.venue ?? ""} maxLength={200} onChange={(e) => setF({ ...f, venue: e.target.value || null })} className="mt-1" /></label>
      </span>
      <span className="flex flex-wrap gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col">Link<Input value={f.link ?? ""} maxLength={1000} onChange={(e) => setF({ ...f, link: e.target.value || null })} placeholder="https://" className="mt-1" /></label>
        <label className="flex min-w-[160px] flex-col">DOI<Input value={f.doi ?? ""} maxLength={200} onChange={(e) => setF({ ...f, doi: e.target.value || null })} className="mt-1 font-mono" /></label>
      </span>
      {code !== undefined ? <span className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1.5">Code<select className="nb-select" value={tri(c)} onChange={(e) => setC(fromTri(e.target.value))}><option value="">Not known</option><option value="yes">Available</option><option value="no">Not available</option></select></label>
        <label className="flex items-center gap-1.5">Data<select className="nb-select" value={tri(dt)} onChange={(e) => setDt(fromTri(e.target.value))}><option value="">Not known</option><option value="yes">Available</option><option value="no">Not available</option></select></label>
      </span> : null}
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.title.trim()} onClick={() => onSave({ ...f, code: c, data: dt })}>Save</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onCancel}>Cancel</button></span>
    </fieldset>
  );
}

/** + Add or Paste BibTeX / RIS (read here, in the browser): rows ticked one by one; ones already in the library are marked. */
function AddSources({ orgId, mode, known, onDone }: { orgId: string; mode: "form" | "paste"; known: LibraryRow[]; onDone: () => void }) {
  const client = useQueryClient();
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState<Array<LabSourceInput & { on: boolean; already: boolean }> | null>(null);
  const have = new Set(known.flatMap((k) => [sourceKey({ title: k.title, doi: null }), ...(k.doi ? [sourceKey({ title: k.title, doi: k.doi })] : [])]));
  const send = async (list: LabSourceInput[]) => {
    const r = await safe(addSourcesAction(orgId, list));
    if (!r.success) return void toast.error(r.error);
    toast.success(r.already.length ? `Added ${r.added}; ${r.already.length} already in the library` : `Added ${r.added}`);
    void client.invalidateQueries({ queryKey: ["lab-library", orgId] });
    onDone();
  };
  const read = () => {
    const { sources, errors } = /^\s*TY\s{1,2}-/m.test(paste) ? parseRis(paste) : parseBibtex(paste);
    errors.forEach((e) => toast.warning(e));
    if (!sources.length) return void toast.error("No entries with a title were found.");
    setRows(sources.slice(0, 200).map((s) => {
      const already = have.has(sourceKey({ title: s.title, doi: null })) || Boolean(s.doi && have.has(sourceKey(s)));
      return { title: s.title, authors: s.authors, year: s.year, venue: s.venue ?? null, link: s.link, doi: s.doi, on: !already, already };
    }));
  };
  if (mode === "form") return <div className="rounded-md border border-border p-3"><SourceForm initial={BLANK} onSave={(v) => void send([{ title: v.title, authors: v.authors, year: v.year, venue: v.venue, link: v.link, doi: v.doi }])} onCancel={onDone} /></div>;
  const chosen = rows?.filter((r) => r.on) ?? [];
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3" data-testid="lab-library-paste">
      <legend className="px-1 font-medium">Paste BibTeX or RIS</legend>
      {!rows ? <>
        <label className="flex flex-col">BibTeX or RIS<textarea className="nb-textarea mt-1 min-h-[120px] font-mono text-[12px]" maxLength={500_000} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="@article{…} or TY  - JOUR" /></label>
        <p className="text-muted-foreground">Read here, in your browser; nothing is looked up.</p>
        <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!paste.trim()} onClick={read}>Read</button><button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
      </> : <>
        <ul className="divide-y divide-border">{rows.map((r, i) => (
          <li key={i} className="py-1.5"><label className="flex items-start gap-2"><input type="checkbox" className="nb-check mt-0.5" checked={r.on} disabled={r.already} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
            <span><span className="font-medium">{r.title}</span>{r.year ? ` · ${r.year}` : ""}{r.venue ? ` · ${r.venue}` : ""}{r.already ? <span className="text-muted-foreground"> · Already in the library</span> : null}
              {r.authors ? <span className="block text-muted-foreground">{r.authors}</span> : null}</span></label></li>))}</ul>
        <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!chosen.length} onClick={() => void send(chosen.map(({ on: _o, already: _a, ...x }) => x))}>Add {chosen.length} {chosen.length === 1 ? "source" : "sources"}</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setRows(null)}>Back</button></span>
      </>}
    </fieldset>
  );
}

/** The lab Overview's Library card (members): its size, my To read and Reading, and the way in. Never anyone else's reading. */
export function LabLibraryCard({ orgId, slug }: { orgId: string; slug: string }) {
  const q = useQuery({ queryKey: ["lab-library-card", orgId], queryFn: () => readLibraryCardAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const href = `/org/${encodeURIComponent(slug)}?tab=docs&library=all`;
  return (
    <OrgCard title="Library" testId="lab-library-card" action={<a className={FORM_SECONDARY_CLASS + " inline-flex items-center"} href={href}>Open the Library</a>}>
      <p className="text-[13px]">{d.total ? `${d.total} ${d.total === 1 ? "source" : "sources"}` : d.admin ? "Add your lab’s key papers: paste BibTeX or RIS in the Library." : "No sources yet."}
        {d.toRead || d.reading ? <span className="text-muted-foreground"> · Your list: {[d.toRead ? `${d.toRead} to read` : null, d.reading ? `${d.reading} reading` : null].filter(Boolean).join(", ")}</span> : null}</p>
      {d.next ? <p className="mt-1 text-[13px]" data-testid="lab-next-session">Reading group {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(d.next.at))}
        {d.next.presenter ? ` · ${d.next.presenter}` : ""} · {d.next.title ?? "Waiting for a paper"}</p> : null}
    </OrgCard>
  );
}
