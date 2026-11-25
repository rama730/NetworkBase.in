"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readCompanyAboutAction, readCompanyWidePageAction, readCompanyWidePagesAction, readNeedsReviewAction, readWhatsNewAction, saveCompanyAboutAction, type CompanyOffice, type CompanyValue } from "@/app/actions/company";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MarkdownPreview from "@/components/workspaces/v2/preview/MarkdownPreview";
import { RailSection } from "@/components/ui/rail-section";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { WORKSPACE_DOC_LIST_QUERY_KEY } from "@/hooks/workspaces/useWorkspaceDocData";

// Report 33.2 (plan B4.1c): a company's Values, Offices and Our teams on About; Settings → Company edits them.
const key = (orgId: string) => ["company-about", orgId] as const;

export function CompanyAboutSections({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readCompanyAboutAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  return (
    <>
      {d.values.length ? (
        <RailSection title="Values">
          <ul className="space-y-2 text-[13px]" data-testid="company-values">{d.values.map((v, i) => <li key={i}><span className="font-medium">{v.name}</span>{v.line ? <span className="text-muted-foreground"> · {v.line}</span> : null}</li>)}</ul>
        </RailSection>
      ) : null}
      {d.offices.length ? (
        <RailSection title="Offices">
          <ul className="space-y-1 text-[13px]" data-testid="company-offices">{d.offices.map((o, i) => <li key={i}><span className="font-medium">{o.name}</span>{o.city ? ` · ${o.city}` : ""}{o.zone ? <span className="font-mono text-muted-foreground"> · {o.zone}</span> : null}</li>)}</ul>
        </RailSection>
      ) : null}
      {d.teams.length ? (
        <RailSection title={`Our teams · ${d.teams.length}`}>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="our-teams">
            {d.teams.map((t) => (
              <li key={t.id} className="rounded-md border border-border p-3 text-[13px]">
                <Link href={`/workspaces/${encodeURIComponent(t.slug ?? t.id)}`} className="font-medium hover:underline">{t.title}</Link>
                {t.line ? <p className="line-clamp-2 text-muted-foreground">{t.line}</p> : null}
                <p className="text-muted-foreground">{t.manager ? `${t.manager} · ` : ""}<span className="font-mono">{t.members}</span> {t.members === 1 ? "member" : "members"}</p>
              </li>
            ))}
          </ul>
        </RailSection>
      ) : null}
    </>
  );
}

/** Settings → Company (owners and admins): Values and Offices, each members-only unless shown to visitors. */
export function CompanySettingsCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readCompanyAboutAction(orgId), staleTime: 60_000 });
  const [values, setValues] = useState<CompanyValue[] | null>(null);
  const [offices, setOffices] = useState<CompanyOffice[] | null>(null);
  const [pub, setPub] = useState<{ values: boolean; offices: boolean } | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d?.admin) return null;
  const v = values ?? d.values, o = offices ?? d.offices, p = pub ?? { values: d.publicValues, offices: d.publicOffices };
  const save = async () => {
    const r = await saveCompanyAboutAction(orgId, { values: v.filter((x) => x.name.trim()), offices: o.filter((x) => x.name.trim()), publicValues: p.values, publicOffices: p.offices });
    if (!r.success) return void toast.error(r.error);
    toast.success("Company saved");
    setValues(null); setOffices(null); setPub(null);
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <SettingsCard title="Company" headingLevel={2} description="Values and offices show on About to everyone in the company; switch either on to show it to visitors too.">
      <div className="space-y-4 text-[13px]" data-testid="company-settings">
        <fieldset className="space-y-1.5"><legend className="font-medium">Values</legend>
          {v.map((x, i) => (
            <span key={i} className="flex flex-wrap gap-2">
              <Input value={x.name} maxLength={60} placeholder="Value" aria-label={`Value ${i + 1}`} onChange={(e) => setValues(v.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className="w-[180px]" />
              <Input value={x.line} maxLength={200} placeholder="What it means here" aria-label={`Value ${i + 1} sentence`} onChange={(e) => setValues(v.map((y, j) => (j === i ? { ...y, line: e.target.value } : y)))} className="min-w-[240px] flex-1" />
            </span>
          ))}
          {v.length < 8 ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setValues([...v, { name: "", line: "" }])}>Add a value</button> : null}
          <label className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={p.values} onChange={(e) => setPub({ ...p, values: e.target.checked })} />Show values to visitors</label>
        </fieldset>
        <fieldset className="space-y-1.5"><legend className="font-medium">Offices</legend>
          {o.map((x, i) => (
            <span key={i} className="flex flex-wrap gap-2">
              <Input value={x.name} maxLength={60} placeholder="Office" aria-label={`Office ${i + 1}`} onChange={(e) => setOffices(o.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className="w-[160px]" />
              <Input value={x.city} maxLength={60} placeholder="City" aria-label={`Office ${i + 1} city`} onChange={(e) => setOffices(o.map((y, j) => (j === i ? { ...y, city: e.target.value } : y)))} className="w-[140px]" />
              <Input value={x.zone} maxLength={60} placeholder="Time zone, e.g. Europe/London" aria-label={`Office ${i + 1} time zone`} onChange={(e) => setOffices(o.map((y, j) => (j === i ? { ...y, zone: e.target.value } : y)))} className="w-[220px] font-mono" />
            </span>
          ))}
          {o.length < 20 ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setOffices([...o, { name: "", city: "", zone: "" }])}>Add an office</button> : null}
          <label className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={p.offices} onChange={(e) => setPub({ ...p, offices: e.target.checked })} />Show offices to visitors</label>
        </fieldset>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save company</button>
      </div>
    </SettingsCard>
  );
}

/** What's new (report 33.2): the last 7 days' announcements and published handbook pages, up to 5. */
export function WhatsNewCard({ orgId, base }: { orgId: string; base: string }) {
  const q = useQuery({ queryKey: ["whats-new", orgId], queryFn: () => readWhatsNewAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d?.items.length) return null;
  return (
    <OrgCard title="What’s new · last 7 days" testId="whats-new">
      <ul className="space-y-1.5 text-[13px]">
        {d.items.map((i) => (
          <li key={`${i.kind}:${i.id}`} className="flex flex-wrap items-center gap-2">
            {i.kind === "announcement" ? <Link href={`${base}?tab=updates`} className="min-w-0 flex-1 truncate hover:underline">{i.text}</Link>
              : <><StatusBadge state={i.kind}>{i.kind === "new" ? "New" : "Updated"}</StatusBadge><Link href={`${base}?tab=docs&doc=${encodeURIComponent(i.slug!)}`} className="min-w-0 flex-1 truncate hover:underline">{i.text}</Link></>}
            <span className="font-mono text-[12px] text-muted-foreground">{i.at.slice(5, 10)}</span>
          </li>
        ))}
      </ul>
    </OrgCard>
  );
}

/** Needs review (report 33.2, admins): handbook pages past Review by, by owner; owners are told in their weekly Summary. */
export function NeedsReviewCard({ orgId, base }: { orgId: string; base: string }) {
  const q = useQuery({ queryKey: ["needs-review", orgId], queryFn: () => readNeedsReviewAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d?.total) return null;
  return (
    <OrgCard title={`Needs review · ${d.total} ${d.total === 1 ? "page" : "pages"}`} testId="needs-review">
      <p className="text-[13px] text-muted-foreground">Owners are told in their weekly Summary. Pages stay visible.</p>
      <ul className="mt-2 space-y-1.5 text-[13px]">
        {d.owners.map((o) => (
          <li key={o.owner}><span className="font-medium">{o.owner}</span>: {o.pages.map((p, i) => (
            <span key={p.slug}>{i ? ", " : ""}<Link href={`${base}?tab=docs&doc=${encodeURIComponent(p.slug)}`} className="hover:underline">{p.title}</Link></span>))}</li>
        ))}
      </ul>
    </OrgCard>
  );
}

/** From teams (report 33.2 call 7): team pages marked Company-wide, read in place; a team's other pages stay in the team. */
export function FromTeamsPages({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["company-wide", orgId], queryFn: () => readCompanyWidePagesAction(orgId), staleTime: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const page = useQuery({ queryKey: ["company-wide-page", orgId, open], queryFn: () => readCompanyWidePageAction(orgId, open!), enabled: Boolean(open), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d?.pages.length) return null;
  const p = page.data?.success ? page.data : null;
  return (
    <div className="space-y-1 pt-3" data-testid="from-teams">
      <p className="nb-micro pb-1">From teams</p>
      <ul className="space-y-1">
        {d.pages.map((x) => (
          <li key={x.id}>
            <button type="button" onClick={() => setOpen(x.id)} className="flex w-full flex-col rounded-md border border-border bg-card px-2.5 py-2 text-left text-[13px] hover:bg-muted">
              <span className="font-medium">{x.title}</span>
              <span className="text-[12px] text-muted-foreground">{x.archived ? "From an archived team" : x.team}</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={Boolean(open)} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent size="wide" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{p?.title ?? "Team page"}</DialogTitle><DialogDescription>{p ? (p.archived ? "From an archived team" : `From ${p.team} · company-wide`) : "A team’s page, shared with the company."}</DialogDescription></DialogHeader>
          {p ? <MarkdownPreview content={p.content} fidelity="app" /> : <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Opening the page…</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A team's page: share it with the whole company (report 33.2 call 7). Shown to its editors when the team is in a company. */
export function CompanyWideToggle({ projectId, docSlug, on }: { projectId: string; docSlug: string; on: boolean }) {
  const client = useQueryClient();
  const inCompany = useQuery({ queryKey: ["in-company", projectId], queryFn: async () => (await import("@/app/actions/workspace/doc")).readInCompanyAction(projectId), staleTime: 300_000 });
  const [busy, setBusy] = useState(false);
  if (!inCompany.data?.inCompany) return null;
  const flip = async () => {
    setBusy(true);
    const { setCompanyWideAction } = await import("@/app/actions/workspace/doc");
    const r = await setCompanyWideAction(projectId, { docSlug, on: !on });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(on ? "Only the team reads it now" : "Everyone in the company can read it");
    void client.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) });
  };
  return (
    <button type="button" aria-pressed={on} disabled={busy} onClick={() => void flip()} data-testid="company-wide-toggle"
      className={FORM_SECONDARY_CLASS}>
      {on ? "Company-wide" : "Share with the company"}
    </button>
  );
}
