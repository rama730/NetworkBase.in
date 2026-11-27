"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Printer } from "lucide-react";

import { readDriveCountsAction, readRecruitingAction, saveRecruitingAction } from "@/app/actions/club";
import { readCommunityEventsAction } from "@/app/actions/community-events";
import { OrgCard } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 36.2 (plan B7.1a, L1): Recruiting now on a club's About, the officers' Recruiting card (dates, line, first event,
// the drive's counts) and the printable join poster (the short link and the code; no QR code).
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const key = (orgId: string) => ["club-recruiting", orgId] as const;

/** About (everyone): the Recruiting now banner while the period lasts. */
export function RecruitingBanner({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readRecruitingAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d?.recruiting) return null;
  return (
    <section aria-label="Recruiting now" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="club-recruiting-banner">
      <Megaphone className="size-4" aria-hidden="true" /><span className="font-medium">Recruiting now</span>
      <span className="text-muted-foreground">until {day(d.to!)}</span>
      {d.line ? <span>{d.line}</span> : null}
      {d.firstEvent ? <span className="text-muted-foreground">First event: {d.firstEvent.title}</span> : null}
    </section>
  );
}

/** Officers (Overview): set the recruiting period, print the poster, see the drive's counts. */
export function RecruitingCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readRecruitingAction(orgId), staleTime: 60_000 });
  const counts = useQuery({ queryKey: ["club-drive", orgId], queryFn: () => readDriveCountsAction(orgId), staleTime: 60_000 });
  const events = useQuery({ queryKey: ["club-events", orgId], queryFn: () => readCommunityEventsAction(orgId, "upcoming"), staleTime: 60_000 });
  const [f, setF] = useState<{ from: string; to: string; line: string; firstEventId: string | null } | null>(null);
  const [printing, setPrinting] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d?.poster) return null;
  const form = f ?? { from: d.settings?.from ?? "", to: d.settings?.to ?? "", line: d.settings?.line ?? "", firstEventId: d.settings?.firstEventId ?? null };
  const c = counts.data?.success ? counts.data.counts : null;
  const save = async (value: typeof form | null) => {
    const r = await safe(saveRecruitingAction(orgId, value));
    if (!r.success) return void toast.error(r.error);
    toast.success(value ? "Recruiting saved" : "Recruiting cleared");
    setF(null); void q.refetch(); void counts.refetch();
  };
  const print = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 50); };
  const upcoming = events.data?.success ? events.data.events.filter((e) => e.state !== "cancelled" && e.state !== "ended") : [];
  return (
    <OrgCard title="Recruiting" testId="club-recruiting" action={<button type="button" className={`${FORM_SECONDARY_CLASS} inline-flex items-center gap-1.5`} onClick={print}><Printer className="size-3.5" aria-hidden="true" />Print the join poster</button>}>
      <div className="space-y-2 text-[13px]">
        <p>{d.recruiting ? <><span className="font-medium">Recruiting now</span> until {day(d.to!)}.</> : d.settings ? "Not recruiting right now." : "Set the dates of your recruiting drive. It turns itself off after the end date."}</p>
        <span className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">From<Input type="date" value={form.from} onChange={(e) => setF({ ...form, from: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">To<Input type="date" value={form.to} onChange={(e) => setF({ ...form, to: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex min-w-[220px] flex-1 flex-col">Banner line<Input value={form.line} maxLength={160} onChange={(e) => setF({ ...form, line: e.target.value })} placeholder="Taster night Thursday: no experience needed" className="mt-0.5" /></label>
          <label className="flex flex-col">First event<select className="nb-select mt-0.5" value={form.firstEventId ?? ""} onChange={(e) => setF({ ...form, firstEventId: e.target.value || null })}>
            <option value="">None</option>{upcoming.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
        </span>
        <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!form.from || !form.to} onClick={() => void save(form)}>Save</button>
          {d.settings ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save(null)}>Clear</button> : null}</span>
        {c ? <p data-testid="club-drive-counts">During the drive ({day(c.from)} to {day(c.to)}): {c.joined} joined, {c.came} of them came to an event.</p> : null}
      </div>
      {printing && typeof document !== "undefined" ? createPortal(<JoinPoster title={d.poster.title} line={d.settings?.line ?? ""} slug={d.poster.slug} code={d.poster.code} />, document.body) : null}
    </OrgCard>
  );
}

/** Call 4: a printable page — the club's name, one line, the short join link and the code, large and high-contrast. */
function JoinPoster({ title, line, slug, code }: { title: string; line: string; slug: string; code: string | null }) {
  const link = `networkbase.in/org/${slug}`;
  return (
    <div id="nb-join-poster" data-testid="club-join-poster">
      <style>{`#nb-join-poster{display:none}@media print{body>*:not(#nb-join-poster){display:none!important}#nb-join-poster{display:flex!important;flex-direction:column;justify-content:center;gap:28pt;min-height:100vh;padding:48pt;background:white;color:black;font-family:inherit}}`}</style>
      <p style={{ fontSize: "44pt", fontWeight: 700, lineHeight: 1.1 }}>{title}</p>
      {line ? <p style={{ fontSize: "22pt" }}>{line}</p> : null}
      <p style={{ fontSize: "20pt" }}>Join at <strong>{link}</strong></p>
      {code ? <p style={{ fontSize: "20pt" }}>or with the join code <strong style={{ fontFamily: "monospace", letterSpacing: "2pt" }}>{code}</strong></p> : null}
    </div>
  );
}
