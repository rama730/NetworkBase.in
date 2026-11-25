/**
 * Report 32.2 (plan B3.1d): Import… a CSV or .ics file in the browser (the server never fetches a URL). Each row
 * becomes a Holiday, Staff day, Half day or Event, with its error shown per row before anything is saved.
 */
export type ImportKind = "holiday" | "staff" | "half" | "event";
export type ImportRow = { name: string; kind: ImportKind; start: string; end: string; time: string | null; place: string; error: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The kind a word names; anything else is an event. */
export function kindOf(word: string): ImportKind {
  const w = word.toLowerCase();
  if (/holiday|break|vacation|half[- ]?term|closed/.test(w)) return "holiday";
  if (/staff|inset|training|teacher day|pd day/.test(w)) return "staff";
  if (/half[- ]?day|early (close|finish)/.test(w)) return "half";
  return "event";
}

function check(r: Omit<ImportRow, "error">): ImportRow {
  const name = r.name.trim().slice(0, 60);
  const error = !name ? "No name" : !valid(r.start) ? "Start isn’t a date (YYYY-MM-DD)" : !valid(r.end) ? "End isn’t a date (YYYY-MM-DD)" : r.end < r.start ? "Ends before it starts"
    : r.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? "Time isn’t HH:MM" : null;
  return { ...r, name, error };
}

/** One CSV line into fields (quotes and doubled quotes). */
function cells(line: string) {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** CSV with a header row: name, type, start, end, time, place (end, time and place optional; type names the kind). */
export function parseCsv(text: string, limit = 300): ImportRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = cells(lines[0]!).map((h) => h.toLowerCase());
  const at = (row: string[], ...names: string[]) => { const i = head.findIndex((h) => names.includes(h)); return i >= 0 ? row[i] ?? "" : ""; };
  return lines.slice(1, limit + 1).map((l) => {
    const row = cells(l);
    const name = at(row, "name", "title", "event"), start = at(row, "start", "date", "start date");
    return check({ name, kind: kindOf(at(row, "type", "kind") || name), start, end: at(row, "end", "end date") || start, time: at(row, "time") || null, place: at(row, "place", "location", "room") });
  });
}

/** .ics: each VEVENT's SUMMARY, DTSTART, DTEND (all-day ends are exclusive) and LOCATION. */
export function parseIcs(text: string, limit = 300): ImportRow[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const rows: ImportRow[] = [];
  let ev: Record<string, string> | null = null;
  const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { ev = {}; continue; }
    if (line === "END:VEVENT" && ev) {
      const d = (v = "") => v.length >= 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : "";
      const start = d(ev.DTSTART), allDay = (ev.DTSTART ?? "").length === 8;
      const rawEnd = d(ev.DTEND) || start;
      const end = allDay && rawEnd > start ? addDays(rawEnd, -1) : rawEnd;
      const time = !allDay && (ev.DTSTART ?? "").length >= 13 && !ev.DTSTART!.endsWith("Z") ? `${ev.DTSTART!.slice(9, 11)}:${ev.DTSTART!.slice(11, 13)}` : null;
      const name = unescape(ev.SUMMARY ?? "");
      rows.push(check({ name, kind: kindOf(`${ev.CATEGORIES ?? ""} ${name}`), start, end, time, place: unescape(ev.LOCATION ?? "").slice(0, 120) }));
      ev = null;
      if (rows.length >= limit) break;
      continue;
    }
    if (!ev) continue;
    const m = /^([A-Z-]+)(?:;[^:]*)?:(.*)$/.exec(line);
    if (m) ev[m[1]!] = m[2]!;
  }
  return rows;
}
