"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { readInstitutionClassesAction, readSchoolAboutAction, type InstitutionClass } from "@/app/actions/institutions";
import { attentionReasons, classCounts } from "@/lib/organizations/school-rules";
import { OrgCard } from "@/components/organizations/org-ui";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { RailSection } from "@/components/ui/rail-section";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";

const href = (o: { slug: string | null; id: string }) => `/org/${encodeURIComponent(o.slug ?? o.id)}`;
const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
const termLabel = (c: InstitutionClass) => (c.termStart && c.termEnd ? `${MONTH.format(new Date(`${c.termStart}T00:00:00Z`))} – ${MONTH.format(new Date(`${c.termEnd}T00:00:00Z`))}` : "No term set");
const useClasses = (orgId: string) => useQuery({ queryKey: ["school-classes", orgId], queryFn: () => readInstitutionClassesAction(orgId), staleTime: 30_000 });

type Group = "department" | "teacher" | "term";

/** A school's Projects tab (report 29.5, B0.2): its classes by department, teacher or term. */
export function SchoolClassesTab({ orgId }: { orgId: string }) {
  const query = useClasses(orgId);
  const [group, setGroup] = useState<Group>("department");
  if (query.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading classes…</p>;
  const data = query.data;
  if (!data?.success) return <ErrorNotice what="Classes" onRetry={() => void query.refetch()} />;
  if (data.classes.length === 0) return <EmptyState figure="organization" title="No classes yet" description="A class joins from its own Settings with Join a school." />;
  const dept = new Map(data.departments.map((d) => [d.id, d.name]));
  const keyOf = (c: InstitutionClass) => (group === "department" ? (c.department ? dept.get(c.department) ?? "No department" : "No department") : group === "teacher" ? c.teacher ?? "No teacher" : termLabel(c));
  const groups = new Map<string, InstitutionClass[]>();
  for (const c of data.classes) groups.set(keyOf(c), [...(groups.get(keyOf(c)) ?? []), c]);
  return (
    <div className="space-y-5" data-testid="school-classes-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="nb-section-title">Classes <span className="nb-meta font-mono">{data.classes.length}</span></h2>
        <UnderlineTabs label="Group classes by" idPrefix="school-group" controls={false} className="w-auto border-b-0" value={group} onChange={setGroup}
          tabs={[{ key: "department", label: "Department" }, { key: "teacher", label: "Teacher" }, { key: "term", label: "Term" }]} />
      </div>
      {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => (
        <section key={name} aria-label={name}>
          <h3 className="nb-micro mb-2">{name} <span className="font-mono">{rows.length}</span></h3>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3" data-testid="school-class-row">
                <span className="min-w-0">
                  <Link href={href(c)} className="font-medium text-foreground hover:underline">{c.title}</Link>
                  {c.teacher && group !== "teacher" ? <span className="ml-2 text-[13px] text-muted-foreground">{c.teacher}</span> : null}
                </span>
                {c.counted ? <span className="nb-meta font-mono">{classCounts(c)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The school's Overview (B0.2): classes needing attention, for its admins and heads of department. */
export function SchoolAttentionCard({ orgId }: { orgId: string }) {
  const query = useClasses(orgId);
  const data = query.data?.success ? query.data : null;
  if (!data || !(data.isAdmin || data.headOf.length)) return null;
  const flagged = data.classes.map((c) => ({ c, reasons: attentionReasons(c) })).filter((r) => r.reasons.length);
  const backlog = data.classes.filter((c) => c.counted).reduce((n, c) => n + c.toReview, 0);
  return (
    <OrgCard title="Classes needing attention" testId="school-attention" action={<span className="nb-meta font-mono">{backlog} to review across classes</span>}>
      {flagged.length === 0 ? <p className="text-[13px] text-muted-foreground">Every class is moving. Nothing needs you.</p> : (
        <ul className="divide-y divide-border text-[13px]">
          {flagged.map(({ c, reasons }) => (
            <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span><Link href={href(c)} className="font-medium hover:underline">{c.title}</Link>{c.teacher ? <span className="text-muted-foreground"> · {c.teacher}</span> : null}</span>
              <span className="text-muted-foreground">{reasons.join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </OrgCard>
  );
}

/** A school's About (B0.2): departments and its public classes. */
export function SchoolAboutSections({ orgId }: { orgId: string }) {
  const query = useQuery({ queryKey: ["school-about", orgId], queryFn: () => readSchoolAboutAction(orgId), staleTime: 60_000 });
  const data = query.data?.success ? query.data : null;
  if (!data) return null;
  return (
    <>
      {data.departments.length ? (
        <RailSection title="Departments">
          <ul className="space-y-1 text-[13px]" data-testid="school-about-departments">{data.departments.map((d) => <li key={d.id}>{d.name}</li>)}</ul>
        </RailSection>
      ) : null}
      <RailSection title="Classes">
        {data.classes.length ? (
          <ul className="space-y-1 text-[13px]" data-testid="school-about-classes">{data.classes.map((c) => <li key={c.id}><Link href={href(c)} className="hover:underline">{c.title}</Link></li>)}</ul>
        ) : <p className="text-[13px] text-muted-foreground">No public classes yet.</p>}
      </RailSection>
    </>
  );
}
