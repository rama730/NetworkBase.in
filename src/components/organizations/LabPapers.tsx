"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";

import { addPaperToProfileAction, confirmAuthorsAction, importPastPapersAction, movePaperAction, readFrozenDraftAction, readLabPapersAction, readPapersAction, reviewPaperAction, savePaperAction } from "@/app/actions/lab-papers";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { matchAuthors, NEXT, PAPER_KINDS, PAPER_STAGE_WORDS, type PaperAuthor, type PaperKind, type PaperStage } from "@/lib/organizations/lab-papers";
import { parseBibtex } from "@/lib/workflows/literature";

// Report 35.3 (plan B6.3a, R2): Papers on a lab workspace's Overview (add, authors and confirmations, stage moves,
// internal review) and the lab's Papers on its Overview. Deadlines and venues are typed; nothing is submitted anywhere.
const wsKey = (id: string) => ["lab-papers", id] as const;
const labKey = (id: string) => ["lab-papers-all", id] as const;
type Paper = Extract<Awaited<ReturnType<typeof readPapersAction>>, { success: true }>["papers"][number];
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const STAGE_BADGE: Record<PaperStage, string> = { idea: "draft", drafting: "draft", internal_review: "at_risk", submitted: "active", revising: "at_risk", accepted: "active", published: "done", withdrawn: "neutral" };
const MOVE_WORDS: Record<string, string> = { drafting: "Start drafting", internal_review: "Ask for internal review", submitted: "Mark submitted", revising: "Revising", accepted: "Accepted",
  published: "Published", withdrawn: "Withdraw", rejected: "Rejected" };

export function WorkspacePapers({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({ queryKey: wsKey(workspaceId), queryFn: () => readPapersAction(workspaceId), staleTime: 30_000 });
  const [adding, setAdding] = useState(false);
  const [past, setPast] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  return (
    <OrgCard title="Papers" testId="lab-papers" action={d.writer && !adding && !past ? <span className="flex gap-2">
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPast(true)}>Add past papers</button>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAdding(true)}>+ Paper</button></span> : null}>
      <div className="space-y-3 text-[13px]">
        {past ? <PastPapers workspaceId={workspaceId} people={d.people} onDone={() => setPast(false)} /> : null}
        {adding ? <PaperForm workspaceId={workspaceId} people={d.people} docs={d.docs} me={d.me} onDone={() => setAdding(false)} /> : null}
        {d.papers.length ? <ul className="divide-y divide-border">{d.papers.map((p) => <PaperRow key={p.id} workspaceId={workspaceId} p={p} people={d.people} docs={d.docs} me={d.me} />)}</ul>
          : <p className="text-muted-foreground">No papers yet. A paper (or preprint, talk, poster, dataset, software) goes Idea to Published here, with its authors.</p>}
      </div>
    </OrgCard>
  );
}

type Doc = { id: string; name: string };
function PaperRow({ workspaceId, p, people, docs, me }: { workspaceId: string; p: Paper; people: Array<{ id: string; name: string }>; docs: Doc[]; me: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => void client.invalidateQueries({ queryKey: wsKey(workspaceId) });
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); setMoving(null); setNote(""); refresh(); };
  if (editing) return <li className="py-2"><PaperForm workspaceId={workspaceId} people={people} docs={docs} me={me} paper={p} onDone={() => { setEditing(false); refresh(); }} /></li>;
  const needsReview = p.reviewOn && p.kind === "paper";
  // Live check: Submitted isn't offered until the PI's approval holds (the server refuses it anyway).
  const next = (NEXT[p.stage] ?? []).filter((s) => !(s === "internal_review" && !needsReview) && !(s === "submitted" && needsReview && !p.reviewed));
  const unconfirmed = p.authors.filter((a) => "userId" in a && !a.confirmed);
  return (
    <li className="space-y-1.5 py-2" data-testid="lab-paper">
      <p className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium">{p.title}</span>
        <StatusBadge state="neutral">{PAPER_KINDS[p.kind as PaperKind]}</StatusBadge>
        <StatusBadge state={STAGE_BADGE[p.stage]}>{PAPER_STAGE_WORDS[p.stage]}</StatusBadge>
        {p.private ? <StatusBadge state="neutral">Private</StatusBadge> : null}
        {p.venue ? <span className="text-muted-foreground">{p.venue}</span> : null}
        {p.deadline ? <span className="font-mono text-muted-foreground">due {p.deadline}</span> : null}
      </p>
      <p>{p.authors.map((a, i) => <span key={i}>{i ? ", " : ""}{a.name}{"userId" in a ? (a.confirmed ? " (confirmed)" : " (not confirmed)") : ""}</span>)}</p>
      {p.draft ? <p className="text-muted-foreground">Draft: <a className="nb-link" href={`/workspaces/${encodeURIComponent(p.workspace.slug ?? p.workspace.id)}?tab=docs&doc=${encodeURIComponent(p.draft.slug)}`}>{p.draft.name}</a></p> : null}
      {p.frozen ? <FrozenDraft workspaceId={workspaceId} paperId={p.id} version={p.frozen.version} /> : null}
      {p.reviewed && p.stage === "internal_review" ? <p className="text-foreground">Approved for submission by the PI.</p> : null}
      {p.history.length ? <details><summary className="cursor-pointer text-muted-foreground">History</summary><ol className="mt-1 space-y-0.5">{p.history.map((h, i) => (
        <li key={i}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(h.at))} · {h.stage === "rejected" ? "Rejected" : PAPER_STAGE_WORDS[h.stage]}{h.venue ? ` · ${h.venue}` : ""}{h.note ? ` · ${h.note}` : ""}</li>))}</ol></details> : null}
      <span className="flex flex-wrap gap-2">
        {p.mine && !p.iConfirmed ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(confirmAuthorsAction(workspaceId, p.id), "You confirmed the author list")}>Confirm the author list</button> : null}
        {p.canAddToProfile ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(addPaperToProfileAction(workspaceId, p.id), "Added to your profile")}>Add to my profile</button> : null}
        {p.onProfile ? <span className="self-center text-muted-foreground">On your profile</span> : null}
        {next.map((s) => <button key={s} type="button" className={FORM_SECONDARY_CLASS} onClick={() => (s === "rejected" || s === "submitted" ? (setMoving(s), setNote(s === "submitted" ? p.venue ?? "" : "")) : void run(movePaperAction(workspaceId, p.id, { to: s }), `${PAPER_STAGE_WORDS[s as PaperStage] ?? "Moved"}`))}>{s === "drafting" && p.stage !== "idea" ? "Back to drafting" : MOVE_WORDS[s]}</button>)}
        {p.canReview && !p.reviewed ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(reviewPaperAction(workspaceId, p.id, { approve: true, note: "" }), "Approved for submission")}>Approve for submission</button> : null}
        {p.canReview ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMoving("return")}>Return with notes</button> : null}
        <button type="button" className="nb-link" onClick={() => setEditing(true)}>Edit<span className="sr-only"> {p.title}</span></button>
      </span>
      {unconfirmed.length && NEXT[p.stage]?.includes("submitted") ? <p className="text-muted-foreground">Waiting for {unconfirmed.map((a) => a.name).join(", ")} to confirm the author list.</p> : null}
      {moving ? (
        <span className="flex flex-wrap items-center gap-2">
          <Input value={note} maxLength={moving === "submitted" ? 200 : 1000} onChange={(e) => setNote(e.target.value)} aria-label={moving === "submitted" ? "Where it was submitted" : "Notes"}
            placeholder={moving === "submitted" ? "Venue (typed; nothing is submitted for you)" : moving === "return" ? "What to change" : "Reviewers’ main point (optional)"} className="min-w-[260px] flex-1" />
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={moving === "return" && !note.trim()} onClick={() => void (moving === "return"
            ? run(reviewPaperAction(workspaceId, p.id, { approve: false, note }), "Returned to Drafting")
            : run(movePaperAction(workspaceId, p.id, moving === "submitted" ? { to: "submitted", ...(note ? { venue: note } : {}) } : { to: "rejected", ...(note ? { note } : {}) }), moving === "submitted" ? "Marked submitted" : "Recorded; back in Drafting"))}>Save</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMoving(null)}>Cancel</button>
        </span>
      ) : null}
    </li>
  );
}

/** B6.3c Add past papers: paste BibTeX (read here, in the browser), tick the rows to add; authors matched to lab people. */
function PastPapers({ workspaceId, people, onDone }: { workspaceId: string; people: Array<{ id: string; name: string }>; onDone: () => void }) {
  const client = useQueryClient();
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState<Array<{ title: string; venue: string; year: number | null; link: string; doi: string; authors: PaperAuthor[]; on: boolean }> | null>(null);
  const nameOf = (a: PaperAuthor) => ("userId" in a ? people.find((p) => p.id === a.userId)?.name ?? "Someone" : a.name);
  const read = () => {
    const { sources, errors } = parseBibtex(paste);
    errors.forEach((e) => toast.warning(e));
    if (!sources.length) return void toast.error("No entries with a title were found.");
    setRows(sources.slice(0, 50).map((x) => ({ title: x.title.slice(0, 300), venue: x.venue ?? "", year: x.year && x.year >= 1900 ? x.year : null, link: x.link ?? "", doi: x.doi ?? "",
      authors: matchAuthors((x.authors ?? "").split(";"), people), on: true })).map((r) => ({ ...r, authors: r.authors.length ? r.authors : [{ name: "Unknown author" }] })));
  };
  const chosen = rows?.filter((r) => r.on) ?? [];
  const add = async () => {
    const r = await safe(importPastPapersAction(workspaceId, chosen.map(({ on: _on, ...x }) => ({ ...x, kind: "paper" as const }))));
    if (!r.success) return void toast.error(r.error);
    toast.success(r.skipped ? `Added ${r.added}; ${r.skipped} already in the lab` : `Added ${r.added}`);
    void client.invalidateQueries({ queryKey: wsKey(workspaceId) });
    onDone();
  };
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3" data-testid="lab-past-papers">
      <legend className="px-1 font-medium">Add past papers</legend>
      {!rows ? <>
        <label className="flex flex-col">BibTeX<textarea className="nb-textarea mt-1 min-h-[120px] font-mono text-[12px]" value={paste} maxLength={200_000} onChange={(e) => setPaste(e.target.value)} placeholder="@article{rao2024, title={…}, author={…}, year={2024}}" /></label>
        <p className="text-muted-foreground">Read here, in your browser; nothing is looked up. Authors who are people in the lab confirm before a paper shows on About.</p>
        <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!paste.trim()} onClick={read}>Read</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
      </> : <>
        <ul className="divide-y divide-border">{rows.map((r, i) => (
          <li key={i} className="py-1.5"><label className="flex items-start gap-2"><input type="checkbox" className="nb-check mt-0.5" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
            <span><span className="font-medium">{r.title}</span>{r.year ? ` · ${r.year}` : ""}{r.venue ? ` · ${r.venue}` : ""}
              <span className="block text-muted-foreground">{r.authors.map((a) => `${nameOf(a)}${"userId" in a ? " (in the lab)" : ""}`).join(", ")}</span></span></label></li>))}</ul>
        <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!chosen.length} onClick={() => void add()}>Add {chosen.length} {chosen.length === 1 ? "paper" : "papers"}</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setRows(null)}>Back</button></span>
      </>}
    </fieldset>
  );
}

/** B6.3b: the draft as sent for internal review, read on demand (it can be long). */
function FrozenDraft({ workspaceId, paperId, version }: { workspaceId: string; paperId: string; version: number }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["lab-paper-draft", paperId, version], queryFn: () => readFrozenDraftAction(workspaceId, paperId), enabled: open, staleTime: Infinity });
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-muted-foreground">Draft sent for internal review (v{version})</summary>
      {!q.data ? <p role="status" className="nb-waiting mt-1 text-muted-foreground"><PixelBeat />Loading the draft…</p> : q.data.success
        ? <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono text-[12px]" data-testid="lab-paper-frozen">{q.data.content}</pre>
        : <p className="mt-1 text-muted-foreground">{q.data.error}</p>}
    </details>
  );
}

function PaperForm({ workspaceId, people, docs, me, paper, onDone }: { workspaceId: string; people: Array<{ id: string; name: string }>; docs: Doc[]; me: string; paper?: Paper; onDone: () => void }) {
  const client = useQueryClient();
  const [f, setF] = useState({ title: paper?.title ?? "", kind: (paper?.kind ?? "paper") as PaperKind, venue: paper?.venue ?? "", deadline: paper?.deadline ?? "", link: paper?.link ?? "", doi: paper?.doi ?? "",
    private: paper?.private ?? false, preprintPublic: paper?.preprintPublic ?? false, draftDocId: paper?.draft?.id ?? null as string | null });
  const [authors, setAuthors] = useState<Array<{ userId: string } | { name: string }>>(paper ? paper.authors.map((a): { userId: string } | { name: string } => (a.userId ? { userId: a.userId } : { name: a.name })) : [{ userId: me }]);
  const [outside, setOutside] = useState("");
  const nameOf = (a: { userId: string } | { name: string }) => ("userId" in a ? people.find((p) => p.id === a.userId)?.name ?? "Someone" : a.name);
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= authors.length) return; const x = [...authors]; [x[i], x[j]] = [x[j]!, x[i]!]; setAuthors(x); };
  const save = async () => {
    const r = await safe(savePaperAction(workspaceId, paper?.id ?? null, { ...f, deadline: f.deadline || null, authors }));
    if (!r.success) return void toast.error(r.error);
    toast.success(paper ? "Paper saved. If the author list changed, authors confirm it again." : "Paper added");
    void client.invalidateQueries({ queryKey: wsKey(workspaceId) });
    onDone();
  };
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3" data-testid="lab-paper-form">
      <legend className="px-1 font-medium">{paper ? "Edit paper" : "New paper"}</legend>
      <span className="flex flex-wrap gap-2">
        <label className="min-w-[240px] flex-1">Title<Input value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} className="mt-1" /></label>
        <label>Kind<select className="nb-select mt-1 block" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PaperKind })}>
          {(Object.keys(PAPER_KINDS) as PaperKind[]).map((k) => <option key={k} value={k}>{PAPER_KINDS[k]}</option>)}</select></label>
      </span>
      <span className="flex flex-wrap gap-2">
        <label className="min-w-[200px] flex-1">Venue (typed)<Input value={f.venue} maxLength={200} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="ICCV 2027" className="mt-1" /></label>
        <label className="flex flex-col">Deadline<Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} className="mt-1 w-auto font-mono" /></label>
      </span>
      <fieldset className="space-y-1">
        <legend className="font-medium">Authors, in order</legend>
        <ol className="space-y-1">{authors.map((a, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2"><span className="font-mono">{i + 1}.</span>{nameOf(a)}{"name" in a ? <span className="text-muted-foreground">(outside, never contacted)</span> : null}
            {i > 0 ? <button type="button" className="nb-link" onClick={() => move(i, -1)}>Up<span className="sr-only"> {nameOf(a)}</span></button> : null}
            {i < authors.length - 1 ? <button type="button" className="nb-link" onClick={() => move(i, 1)}>Down<span className="sr-only"> {nameOf(a)}</span></button> : null}
            {authors.length > 1 ? <button type="button" className="nb-link" onClick={() => setAuthors(authors.filter((_, j) => j !== i))}>Remove<span className="sr-only"> {nameOf(a)}</span></button> : null}</li>))}</ol>
        <span className="flex flex-wrap items-center gap-2">
          <select className="nb-select" aria-label="Add an author from the lab" value="" onChange={(e) => e.target.value && setAuthors([...authors, { userId: e.target.value }])}>
            <option value="">Add someone from the lab</option>{people.filter((p) => !authors.some((a) => "userId" in a && a.userId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <Input value={outside} maxLength={120} onChange={(e) => setOutside(e.target.value)} aria-label="Outside author name" placeholder="Outside author's name" className="w-[200px]" />
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!outside.trim()} onClick={() => { setAuthors([...authors, { name: outside.trim() }]); setOutside(""); }}>Add name</button>
        </span>
      </fieldset>
      {docs.length || f.draftDocId ? <label className="flex flex-col">Draft document<select className="nb-select mt-1 max-w-[360px]" value={f.draftDocId ?? ""} onChange={(e) => setF({ ...f, draftDocId: e.target.value || null })}>
        <option value="">None</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <span className="mt-0.5 text-muted-foreground">Ask for internal review sends it as it is then, so the review matches what was read.</span></label> : null}
      <span className="flex flex-wrap gap-2">
        <label className="min-w-[200px] flex-1">Link<Input value={f.link} maxLength={500} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://" className="mt-1" /></label>
        <label className="min-w-[160px]">DOI<Input value={f.doi} maxLength={200} onChange={(e) => setF({ ...f, doi: e.target.value })} className="mt-1 font-mono" /></label>
      </span>
      <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.private} onChange={(e) => setF({ ...f, private: e.target.checked })} />Private: only its authors and the PI see it</label>
      {f.kind === "preprint" ? <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.preprintPublic} onChange={(e) => setF({ ...f, preprintPublic: e.target.checked })} />Show this preprint on the lab’s public page</label> : null}
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.title.trim() || !authors.length} onClick={() => void save()}>Save paper</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
    </fieldset>
  );
}

/** The lab's Papers (lab Overview): every workspace's papers, the PI's internal reviews first; counts never rank people. */
/**
 * B6.3b (report 35.3 call 6): the PI's internal reviews in the lab's Review queue — the draft as it was sent, then
 * Approve for submission or Return with notes. Nothing shows for other organizations or when none are waiting.
 */
export function LabPaperReviews({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: labKey(orgId), queryFn: () => readLabPapersAction(orgId), staleTime: 30_000 });
  const waiting = q.data?.success ? q.data.papers.filter((p) => p.canReview && !p.reviewed) : [];
  if (!waiting.length) return null;
  return (
    <section aria-labelledby="lab-paper-reviews" className="mx-4 mt-3 space-y-2 rounded-md border border-border p-3 text-[13px] sm:mx-5" data-testid="lab-paper-reviews">
      <h3 id="lab-paper-reviews" className="font-medium">Internal review · {waiting.length} {waiting.length === 1 ? "paper" : "papers"}</h3>
      <ul className="divide-y divide-border">{waiting.map((p) => <PaperReview key={p.id} p={p} onDone={() => void q.refetch()} />)}</ul>
    </section>
  );
}

function PaperReview({ p, onDone }: { p: Paper; onDone: () => void }) {
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const decide = async (approve: boolean) => {
    const r = await safe(reviewPaperAction(p.workspace.id, p.id, { approve, note: approve ? "" : note }));
    if (!r.success) return void toast.error(r.error);
    toast.success(approve ? "Approved for submission" : "Returned to Drafting");
    onDone();
  };
  return (
    <li className="space-y-1.5 py-2" data-testid="lab-paper-review">
      <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.title}</span><StatusBadge state="neutral">{PAPER_KINDS[p.kind as PaperKind]}</StatusBadge>
        <a href={`/workspaces/${encodeURIComponent(p.workspace.slug ?? p.workspace.id)}`} className="nb-link">{p.workspace.title}</a></p>
      <p className="text-muted-foreground">{p.authors.map((a) => a.name).join(", ")}{p.venue ? ` · for ${p.venue}` : ""}</p>
      {p.frozen ? <FrozenDraft workspaceId={p.workspace.id} paperId={p.id} version={p.frozen.version} /> : <p className="text-muted-foreground">No draft document is linked; review it from its workspace.</p>}
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void decide(true)}>Approve for submission<span className="sr-only"> {p.title}</span></button>
        {returning ? <>
          <Input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} aria-label="What to change" placeholder="What to change" className="min-w-[240px] flex-1" />
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!note.trim()} onClick={() => void decide(false)}>Return</button>
        </> : <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setReturning(true)}>Return with notes<span className="sr-only"> {p.title}</span></button>}
      </span>
    </li>
  );
}

export function LabPapersCard({ orgId, slug }: { orgId: string; slug: string }) {
  const q = useQuery({ queryKey: labKey(orgId), queryFn: () => readLabPapersAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d || !d.papers.length) return null;
  const mine = d.papers.filter((p) => p.canReview && !p.reviewed);
  return (
    <OrgCard title="Papers" testId="lab-papers-all">
      <div className="space-y-2 text-[13px]">
        {mine.length ? <p className="font-medium">Waiting for your internal review: {mine.map((p) => p.title).join(", ")} · <a className="nb-link" href={`/org/${encodeURIComponent(slug)}?tab=tasks&taskScope=review`}>Open the Review queue</a></p> : null}
        <ul className="divide-y divide-border">{d.papers.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className="font-medium">{p.title}</span>
            <StatusBadge state={STAGE_BADGE[p.stage]}>{PAPER_STAGE_WORDS[p.stage]}</StatusBadge>
            <span className="text-muted-foreground">{PAPER_KINDS[p.kind as PaperKind]} · {p.authors.map((a) => a.name).join(", ")}</span>
            <a href={`/workspaces/${encodeURIComponent(p.workspace.slug ?? p.workspace.id)}`} className="nb-link">{p.workspace.title}</a>
            {p.mine && !p.iConfirmed ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void safe(confirmAuthorsAction(p.workspace.id, p.id)).then((r) => {
              if (!r.success) return void toast.error(r.error); toast.success("You confirmed the author list"); void q.refetch(); })}>Confirm the author list<span className="sr-only"> of {p.title}</span></button> : null}
            {p.canAddToProfile ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void safe(addPaperToProfileAction(p.workspace.id, p.id)).then((r) => {
              if (!r.success) return void toast.error(r.error); toast.success("Added to your profile"); void q.refetch(); })}>Add to my profile<span className="sr-only"> {p.title}</span></button> : null}
            {p.deadline ? <span className="font-mono text-muted-foreground">due {p.deadline}</span> : null}</li>))}</ul>
      </div>
    </OrgCard>
  );
}
