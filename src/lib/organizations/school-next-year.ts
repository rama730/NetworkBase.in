import type { EventFields } from "@/lib/organizations/school-events";
import { yearSpan, type SchoolYear } from "@/lib/organizations/school-year";

/**
 * Report 32.2 call 6 (plan B3.1d): Start next year, pure. An event's place is its term week ("Week 3 of Term 1, Tue");
 * the new year puts it in the same place. Repeating events are copied; one-off events are offered as a list to tick.
 * A place the new year doesn't have (a shorter term, a missing term) can't be copied.
 */
const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monday = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const sorted = (y: SchoolYear) => [...y.terms].sort((a, b) => a.start.localeCompare(b.start));

export type TermPlace = { term: number; week: number; weekday: number };

export function termPlace(day: string, year: SchoolYear): TermPlace | null {
  const terms = sorted(year);
  const term = terms.findIndex((t) => day >= t.start && day <= t.end);
  if (term < 0) return null;
  const week = Math.round((Date.parse(`${monday(day)}T00:00:00Z`) - Date.parse(`${monday(terms[term]!.start)}T00:00:00Z`)) / (7 * DAY)) + 1;
  return { term, week, weekday: (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7 };
}

export function dayAt(place: TermPlace, year: SchoolYear): string | null {
  const t = sorted(year)[place.term];
  if (!t) return null;
  const day = addDays(monday(t.start), (place.week - 1) * 7 + place.weekday);
  return day >= t.start && day <= t.end ? day : null;
}

type Ev = { id: string; title: string; fields: EventFields };
/** Repeats move to the same term week and run to the same place (or the new year's end); one-offs are offered with their new day. */
export function planNextYear(events: Ev[], from: SchoolYear, to: SchoolYear) {
  const copy: Array<{ id: string; title: string; fields: EventFields }> = [];
  const offer: Array<{ id: string; title: string; from: string; fields: EventFields }> = [];
  const cannot: Array<{ id: string; title: string; from: string }> = [];
  const end = yearSpan(to).end;
  for (const e of events) {
    const place = termPlace(e.fields.date, from);
    const date = place ? dayAt(place, to) : null;
    if (!date) { cannot.push({ id: e.id, title: e.title, from: e.fields.date }); continue; }
    if (e.fields.repeat) {
      const untilPlace = termPlace(e.fields.repeat.until, from);
      const until = (untilPlace && dayAt(untilPlace, to)) || end;
      copy.push({ id: e.id, title: e.title, fields: { ...e.fields, date, until: null, repeat: { every: e.fields.repeat.every, until: until < date ? end : until } } });
    } else {
      offer.push({ id: e.id, title: e.title, from: e.fields.date, fields: { ...e.fields, date, until: null } });
    }
  }
  return { copy, offer, cannot };
}
