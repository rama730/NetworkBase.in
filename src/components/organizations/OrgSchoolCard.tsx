"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { decideClassRequestAction, joinInstitutionAction, makeInstitutionAction, readClassInstitutionAction, readInstitutionClassesAction, unlinkClassAction, type InstitutionClass } from "@/app/actions/institutions";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { formatInZone } from "@/lib/organizations/zoned-time";

const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const href = (o: { slug: string | null; id: string }) => `/org/${encodeURIComponent(o.slug ?? o.id)}`;
type ClassSide = Extract<Awaited<ReturnType<typeof readClassInstitutionAction>>, { success: true }>;
type SchoolSide = Extract<Awaited<ReturnType<typeof readInstitutionClassesAction>>, { success: true }>;

/**
 * Report 29.2 (plan B0.1), Settings → Organization level. A school sees its classes as counts only and decides
 * requests; a class joins or leaves a school; an empty Education organization can become a school.
 */
export function OrgSchoolCard({ orgId, isSchool }: { orgId: string; isSchool: boolean }) {
  const [school, setSchool] = useState<SchoolSide | null>(null);
  const [cls, setCls] = useState<ClassSide | null>(null);
  const [pick, setPick] = useState("");
  const [confirm, setConfirm] = useState<"make" | "leave" | null>(null);
  const refresh = useCallback(async () => {
    if (isSchool) {
      const r = await readInstitutionClassesAction(orgId);
      if (r.success && r.isAdmin) setSchool(r);
    } else {
      const r = await readClassInstitutionAction(orgId);
      if (r.success) setCls(r);
    }
  }, [orgId, isSchool]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (p: Promise<{ success: true } | { success: false; error: string }>, done: string) => {
    const r = await p;
    if (!r.success) throw new Error(r.error);
    toast(done);
    await refresh();
  };

  if (isSchool) {
    if (!school) return null;
    return (
      <section id="project-settings-org-school" data-project-settings-section className="space-y-6">
        <SettingsCard title="Classes" headingLevel={2} description="Classes that are part of this school. You see counts only, never students’ work.">
          {school.requests.length > 0 ? (
            <div className="divide-y divide-border" data-testid="school-requests">
              {school.requests.map((r) => (
                <SettingsRow key={r.id} title={r.title} description="Wants to join this school."
                  right={<span className="flex gap-2">
                    <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(decideClassRequestAction(orgId, r.id, true), `${r.title} joined`).catch((e: Error) => toast.error(e.message))}>Approve<span className="sr-only"> {r.title}</span></button>
                    <button type="button" className={LINK} onClick={() => void run(decideClassRequestAction(orgId, r.id, false), "Request declined").catch((e: Error) => toast.error(e.message))}>Decline<span className="sr-only"> {r.title}</span></button>
                  </span>} />
              ))}
            </div>
          ) : null}
          {school.classes.length === 0 ? (
            <p className="nb-compact text-muted-foreground" data-testid="school-classes-none">No classes yet. A class joins from its own Settings with Join a school.</p>
          ) : (
            <div className="divide-y divide-border" data-testid="school-classes">
              {school.classes.map((c: InstitutionClass) => (
                <SettingsRow key={c.id} title={<Link href={href(c)} className="hover:underline">{c.title}</Link>}
                  description={c.teacher ? `Teacher ${c.teacher}` : undefined}
                  meta={<span className="font-mono">{c.members} members · {c.openAssignments} open assignments · {c.toReview} to review{c.lastActivity ? ` · active ${formatInZone(c.lastActivity, { month: "short", day: "numeric" }, null)}` : ""}</span>}
                  right={<button type="button" className={LINK} onClick={() => void run(unlinkClassAction(c.id), `${c.title} removed from the school`).catch((e: Error) => toast.error(e.message))}>Remove<span className="sr-only"> {c.title}</span></button>} />
              ))}
            </div>
          )}
        </SettingsCard>
      </section>
    );
  }

  if (!cls || (!cls.eligible && !cls.institution)) return null;
  const schools = cls.schools;
  return (
    <section id="project-settings-org-school" data-project-settings-section className="space-y-6">
      <SettingsCard title="School" headingLevel={2} description="A class can be part of one school. The school sees counts only: members, open assignments and the review backlog.">
        {cls.institution ? (
          <SettingsRow title={<>Part of <Link href={href(cls.institution)} className="text-primary hover:underline">{cls.institution.title}</Link></>}
            right={<button type="button" className={LINK} onClick={() => setConfirm("leave")}>Leave the school</button>} />
        ) : cls.pending ? (
          <SettingsRow title={`Asked to join ${cls.pending.title}`} description="Its admins approve or decline."
            right={<button type="button" className={LINK} onClick={() => void run(unlinkClassAction(orgId), "Request cancelled").catch((e: Error) => toast.error(e.message))}>Cancel request</button>} />
        ) : (
          <SettingsRow title="Join a school" description={schools.length ? "Pick a school you belong to. Its admins approve, unless you’re one of them." : "Join a school’s organization first; it then shows here."}>
            {schools.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select aria-label="School" className="nb-select min-w-[220px] flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Choose a school</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
                <button type="button" className={FORM_SECONDARY_CLASS} disabled={!pick}
                  onClick={() => void joinInstitutionAction(orgId, pick).then(async (r) => {
                    if (!r.success) { toast.error(r.error); return; }
                    toast(r.outcome === "joined" ? "Joined the school" : "Request sent");
                    setPick("");
                    await refresh();
                  })}>Join</button>
              </div>
            ) : null}
          </SettingsRow>
        )}
        {cls.canBecomeSchool ? (
          <SettingsRow title="Make this a school" description="A school holds classes instead of workspaces. Classes join it; it sees their counts, never their work."
            right={<button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setConfirm("make")}>Make a school</button>} />
        ) : null}
      </SettingsCard>
      <ConfirmDialog open={confirm === "make"} onOpenChange={(open) => { if (!open) setConfirm(null); }} title="Make this a school?"
        description="It will hold classes, not workspaces. Classes join it from their own Settings." confirmLabel="Make a school"
        onConfirm={async () => { await run(makeInstitutionAction(orgId), "This is a school now"); window.location.reload(); }} />
      <ConfirmDialog open={confirm === "leave"} onOpenChange={(open) => { if (!open) setConfirm(null); }} title="Leave the school?"
        description="The school stops seeing this class’s counts. Nothing in the class changes." confirmLabel="Leave the school"
        onConfirm={() => run(unlinkClassAction(orgId), "Left the school")} />
    </section>
  );
}
