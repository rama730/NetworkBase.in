"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { importSchoolCalendarAction, previewNextYearAction, startNextYearAction } from "@/app/actions/school-calendar";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { parseCsv, parseIcs, type ImportKind, type ImportRow } from "@/lib/organizations/school-import";

// Report 32.2 call 6 and the Import preview (plan B3.1d): Start next year, and Import… a CSV or .ics with a preview.
const KIND_WORDS: Record<ImportKind, string> = { holiday: "Holiday", staff: "Staff day", half: "Half day", event: "Event" };
type Term = { name: string; start: string; end: string };
type Preview = { copy: Array<{ id: string; title: string; date: string }>; offer: Array<{ id: string; title: string; from: string; date: string }>; cannot: Array<{ id: string; title: string; from: string }> };

export function StartNextYear({ schoolId, current }: { schoolId: string; current: { name: string; terms: Term[] } }) {
  const client = useQueryClient();
  const shift = (d: string) => (d ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : "");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [terms, setTerms] = useState<Term[]>(() => current.terms.map((t) => ({ name: t.name, start: shift(t.start), end: shift(t.end) })));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const year = { name: name.trim() || current.name, terms, days: [] };
  if (!open) return <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setOpen(true)}>Start next year</button>;
  const look = async () => {
    setBusy(true);
    const r = await previewNextYearAction(schoolId, year);
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    setPreview(r);
    setKeep(new Set(r.offer.map((o) => o.id)));
  };
  const start = async () => {
    setBusy(true);
    const r = await startNextYearAction(schoolId, year, [...keep]);
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(`Next year started · ${r.added} ${r.added === 1 ? "event" : "events"} added · ${r.classes} ${r.classes === 1 ? "class follows" : "classes follow"} it`);
    setOpen(false);
    setPreview(null);
    void client.invalidateQueries({ queryKey: ["school-year", schoolId] });
    void client.invalidateQueries({ queryKey: ["school-events", schoolId] });
  };
  return (
    <section aria-label="Start next year" className="space-y-2 rounded-md border border-border p-3 text-[13px]" data-testid="start-next-year">
      <p className="text-muted-foreground">Type next year’s terms. Repeating events move to the same week of term; you pick which one-off events come too. Holidays are added after.</p>
      <Input value={name} maxLength={40} placeholder="Next year’s name" aria-label="Next year’s name" onChange={(e) => { setName(e.target.value); setPreview(null); }} className="w-[220px]" />
      {terms.map((t, i) => (
        <span key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-[80px]">{t.name}</span>
          <Input type="date" value={t.start} aria-label={`${t.name} start next year`} onChange={(e) => { setTerms(terms.map((x, j) => (j === i ? { ...x, start: e.target.value } : x))); setPreview(null); }} className="w-[160px] font-mono" />
          <Input type="date" value={t.end} aria-label={`${t.name} end next year`} onChange={(e) => { setTerms(terms.map((x, j) => (j === i ? { ...x, end: e.target.value } : x))); setPreview(null); }} className="w-[160px] font-mono" />
        </span>
      ))}
      {preview ? (
        <div className="space-y-2" data-testid="next-year-preview">
          <p>{preview.copy.length} repeating {preview.copy.length === 1 ? "event moves" : "events move"} on their own{preview.copy.length ? `: ${preview.copy.map((e) => e.title).join(", ")}` : ""}.</p>
          {preview.offer.length ? (
            <fieldset className="space-y-1"><legend className="font-medium">One-off events to bring</legend>
              {preview.offer.map((o) => (
                <label key={o.id} className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={keep.has(o.id)}
                  onChange={(e) => { const next = new Set(keep); if (e.target.checked) next.add(o.id); else next.delete(o.id); setKeep(next); }} />{o.title} <span className="font-mono text-muted-foreground">{o.from} to {o.date}</span></label>
              ))}
            </fieldset>
          ) : null}
          {preview.cannot.length ? <p className="text-muted-foreground">Can’t move (next year has no such week): {preview.cannot.map((e) => e.title).join(", ")}.</p> : null}
        </div>
      ) : null}
      <span className="flex gap-2">
        {preview ? <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void start()}>Start next year</button>
          : <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || terms.some((t) => !t.start || !t.end)} onClick={() => void look()}>Preview</button>}
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => { setOpen(false); setPreview(null); }}>Cancel</button>
      </span>
    </section>
  );
}

export function ImportCalendar({ schoolId, onDone }: { schoolId: string; onDone: () => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) return void toast.error("Import a file under 1 MB.");
    const text = await file.text();
    setRows(/\.ics$/i.test(file.name) || text.includes("BEGIN:VCALENDAR") ? parseIcs(text) : parseCsv(text));
  };
  const good = (rows ?? []).filter((r) => !r.error);
  const save = async () => {
    setBusy(true);
    const r = await importSchoolCalendarAction(schoolId, good);
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(`Imported ${r.days} ${r.days === 1 ? "day" : "days"} and ${r.events} ${r.events === 1 ? "event" : "events"}`);
    setRows(null);
    onDone();
  };
  return (
    <section aria-label="Import a calendar" className="space-y-2 rounded-md border border-border p-3 text-[13px]" data-testid="import-calendar">
      <p className="text-muted-foreground">A CSV (name, type, start, end, time, place) or an .ics file. Nothing is saved until you check the preview.</p>
      <input type="file" accept=".csv,.ics,text/csv,text/calendar" aria-label="Calendar file" onChange={(e) => void read(e.target.files?.[0])} />
      {rows ? (
        <>
          <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Import preview" tabIndex={0}>
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">As</th><th className="px-3 py-2 font-medium">Dates</th><th className="px-3 py-2 font-medium">Check</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0" data-testid="import-row">
                    <td className="px-3 py-2">{r.name || "—"}</td>
                    <td className="px-3 py-2"><select className="nb-select" data-size="sm" aria-label={`Import ${r.name || `row ${i + 1}`} as`} value={r.kind}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value as ImportKind } : x)))}>
                      {(Object.keys(KIND_WORDS) as ImportKind[]).map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}</select></td>
                    <td className="px-3 py-2 font-mono">{r.start}{r.end !== r.start ? ` – ${r.end}` : ""}{r.time ? ` ${r.time}` : ""}</td>
                    <td className="px-3 py-2">{r.error ?? "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="flex gap-2">
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !good.length} onClick={() => void save()}>Import {good.length} {good.length === 1 ? "row" : "rows"}</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => { setRows(null); onDone(); }}>Cancel</button>
          </span>
        </>
      ) : null}
    </section>
  );
}
