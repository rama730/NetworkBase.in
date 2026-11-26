"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { addSourcesAction, deleteSourceAction, linkToLabLibraryAction, readLiteratureAction, setScreeningAction, setSystematicReviewAction, type LiteratureRow } from "@/app/actions/literature";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { saveBlob } from "@/lib/download";
import { toast } from "@/lib/feedback";
import { SCREEN_WORDS, screeningCounts } from "@/lib/organizations/lab-library";
import { parseBibtex, toBibtex } from "@/lib/workflows/literature";
import { cn } from "@/lib/utils";

// Report 30.6 W5 (plan B1.8b): Literature — a table of sources, by key issue or by year; add one, paste BibTeX, export.
type Group = "table" | "issue" | "year";
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
// B6.4c (report 35.4 call 5): a systematic review's screening.
type Screen = keyof typeof SCREEN_WORDS;

export function LiteratureView({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const client = useQueryClient();
  const key = ["literature", projectId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => readLiteratureAction(projectId), staleTime: 30_000 });
  const [group, setGroup] = useState<Group>("table");
  const [search, setSearch] = useState("");
  const [paste, setPaste] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; authors: string; year: string; link: string; keyIssues: string } | null>(null);
  const rows = useMemo(() => {
    const all = q.data?.success ? q.data.rows : [];
    const s = search.trim().toLowerCase();
    return s ? all.filter((r) => [r.title, r.authors, r.keyIssues.join(" "), r.summary].some((v) => v?.toLowerCase().includes(s))) : all;
  }, [q.data, search]);
  if (q.isPending) return <div role="status" aria-label="Loading the literature" className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-8 rounded-md" aria-hidden="true" />)}</div>;
  if (!q.data?.success) return <p className="text-[13px] text-muted-foreground">Couldn’t load the literature. <button type="button" className={LINK} onClick={() => void q.refetch()}>Try again</button></p>;
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const add = async (sources: unknown[], done: string) => {
    const r = await addSourcesAction(projectId, sources);
    if (!r.success) return void toast.error(r.error);
    toast.success(`${done}: ${r.added} added${r.skipped ? `, ${r.skipped} already in the list` : ""}`);
    await refresh();
  };
  const linkToLab = async (ids: string[]) => {
    const r = await linkToLabLibraryAction(projectId, ids);
    if (!r.success) return void toast.error(r.error);
    toast.success(`${r.linked} linked to the lab’s Library`);
    await refresh();
  };
  const importBib = async () => {
    const { sources, errors } = parseBibtex(paste ?? "");
    errors.forEach((e) => toast.warning(e));
    if (!sources.length) return void toast.error("No entries with a title were found.");
    await add(sources, "BibTeX");
    setPaste(null);
  };
  const addOne = async () => {
    if (!draft?.title.trim()) return void toast.error("Every source needs a title.");
    const year = Number.parseInt(draft.year, 10);
    await add([{ title: draft.title, authors: draft.authors || null, year: Number.isFinite(year) ? year : null, link: draft.link || null, keyIssues: draft.keyIssues.split(",").map((k) => k.trim()).filter(Boolean) }], "Source");
    setDraft(null);
  };
  const groups: Array<[string, LiteratureRow[]]> = group === "table" ? [["", rows]]
    : group === "year" ? [...new Set(rows.map((r) => r.year ?? 0))].sort((a, b) => b - a).map((y) => [y ? String(y) : "No year", rows.filter((r) => (r.year ?? 0) === y)])
      : [...new Set(rows.flatMap((r) => (r.keyIssues.length ? r.keyIssues : ["No key issue"])))].sort().map((k) => [k, rows.filter((r) => (r.keyIssues.length ? r.keyIssues.includes(k) : k === "No key issue"))]);
  return (
    <section aria-label="Literature" className="space-y-3 text-[13px]" data-testid="literature-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="nb-section-title">Literature <span className="nb-meta font-mono">{q.data.rows.length}</span></h2>
        {q.data.lab ? <a className={LINK} href={`/org/${encodeURIComponent(q.data.lab.orgId)}?tab=docs&library=all`}>The lab’s Library</a> : null}
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex gap-1">
            {(["table", "issue", "year"] as const).map((g) => (
              <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={cn("rounded-sm px-2 py-1 text-[12px]", group === g ? "bg-foreground font-semibold text-background" : "text-muted-foreground hover:bg-muted")}>
                {g === "table" ? "Table" : g === "issue" ? "By key issue" : "By year"}</button>
            ))}
          </div>
          <Input aria-label="Search the literature" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-[160px]" />
          {q.data.rows.length ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => saveBlob(new Blob([toBibtex(q.data.success ? q.data.rows : [])], { type: "application/x-bibtex" }), "literature.bib")}>Export BibTeX</button> : null}
        </div>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {draft === null ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft({ title: "", authors: "", year: "", link: "", keyIssues: "" })}>Add a source</button> : null}
          {paste === null ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPaste("")}>Paste BibTeX</button> : null}
          {q.data.lab && q.data.rows.some((r) => !r.labSourceId) ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void linkToLab(q.data.success ? q.data.rows.filter((r) => !r.labSourceId).map((r) => r.id) : [])}>Link all to the lab’s Library</button> : null}
          <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={q.data.systematic} onChange={(e) => void setSystematicReviewAction(projectId, e.target.checked).then((r) => { if (r.success) void refresh(); else toast.error(r.error); })} />Systematic review</label>
        </div>
      ) : null}
      {draft ? (
        <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2" data-testid="source-form">
          <Input aria-label="Title" placeholder="Title" value={draft.title} maxLength={500} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="sm:col-span-2" />
          <Input aria-label="Authors" placeholder="Authors (Rao, A.; Iyer, D.)" value={draft.authors} onChange={(e) => setDraft({ ...draft, authors: e.target.value })} />
          <Input aria-label="Year" placeholder="Year" inputMode="numeric" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
          <Input aria-label="Link" placeholder="https://" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} />
          <Input aria-label="Key issues" placeholder="Key issues, comma separated" value={draft.keyIssues} onChange={(e) => setDraft({ ...draft, keyIssues: e.target.value })} />
          <span className="flex gap-2 sm:col-span-2"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void addOne()}>Add source</button><button type="button" className={LINK} onClick={() => setDraft(null)}>Cancel</button></span>
        </div>
      ) : null}
      {paste !== null ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <textarea className="nb-textarea font-mono text-[12px]" rows={6} aria-label="BibTeX" placeholder="@article{…}" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void importBib()}>Add from BibTeX</button><button type="button" className={LINK} onClick={() => setPaste(null)}>Cancel</button></span>
        </div>
      ) : null}
      {q.data.systematic ? (() => { const c = screeningCounts(q.data.success ? q.data.rows : []); return (
        <p className="text-[13px]" data-testid="screening-counts">{c.found} found, {c.screened} screened, {c.included} included, {c.excluded} excluded</p>); })() : null}
      {rows.length === 0 ? <p className="nb-empty-state text-muted-foreground">{q.data.rows.length ? "No sources match." : "No sources yet. Add one, or paste BibTeX."}</p> : groups.map(([name, list]) => (
        <div key={name || "all"} className="space-y-1">
          {name ? <h3 className="nb-micro">{name} <span className="font-mono">{list.length}</span></h3> : null}
          <ul className="divide-y divide-border rounded-md border border-border" aria-label={name || "Sources"}>
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  {r.link ? <a href={r.link} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">{r.title}</a> : <span className="font-medium">{r.title}</span>}
                  <span className="block text-muted-foreground">{[r.authors, r.year, r.doi ? `doi ${r.doi}` : null].filter(Boolean).join(" · ")}</span>
                  {r.keyIssues.length ? <span className="mt-0.5 flex flex-wrap gap-1">{r.keyIssues.map((k) => <span key={k} className="nb-tag">{k}</span>)}</span> : null}
                  {q.data.success && q.data.lab ? (r.labSourceId ? <span className="block text-muted-foreground">In the lab’s Library</span>
                    : canEdit ? <button type="button" className={LINK} onClick={() => void linkToLab([r.id])}>Add to the lab’s Library<span className="sr-only"> {r.title}</span></button> : null) : null}
                  {q.data.success && q.data.systematic ? <Screening row={r} canEdit={canEdit} onSave={(state, reason) => void setScreeningAction(projectId, r.id, { state, reason }).then((x) => { if (x.success) void refresh(); else toast.error(x.error); })} /> : null}
                </span>
                {canEdit ? <button type="button" className={LINK} onClick={() => void deleteSourceAction(projectId, r.id).then(() => refresh())}>Remove<span className="sr-only"> {r.title}</span></button> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Screening({ row, canEdit, onSave }: { row: LiteratureRow; canEdit: boolean; onSave: (state: Screen, reason: string) => void }) {
  const [state, setState] = useState<Screen>(row.screening ?? "found");
  const [reason, setReason] = useState(row.excludeReason ?? "");
  if (!canEdit) return <span className="block">{SCREEN_WORDS[row.screening ?? "found"]}{row.excludeReason ? `: ${row.excludeReason}` : ""}</span>;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <select className="nb-select" aria-label={`Screening for ${row.title}`} value={state} onChange={(e) => { const v = e.target.value as Screen; setState(v); if (v !== "excluded") onSave(v, ""); }}>
        {(Object.keys(SCREEN_WORDS) as Screen[]).map((k) => <option key={k} value={k}>{SCREEN_WORDS[k]}</option>)}</select>
      {state === "excluded" ? <><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-label={`Why ${row.title} is excluded`} placeholder="Why it’s excluded" className="h-8 w-[220px]" />
        <button type="button" className={LINK} disabled={!reason.trim()} onClick={() => onSave("excluded", reason)}>Save</button></> : null}
    </span>
  );
}
