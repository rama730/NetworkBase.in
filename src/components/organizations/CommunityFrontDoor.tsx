"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { agreeToCodeAction, readCommunityRulesAction, readJoiningSettingsAction, readMyCommunityAction, saveJoiningSettingsAction, tickGettingStartedAction } from "@/app/actions/community-front-door";
import { OrgCard } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { RailSection } from "@/components/ui/rail-section";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import type { CommunitySettings } from "@/lib/organizations/community";

// Report 34.2 (plan B5.1, M1): the rules summary on About, I agree and Getting started on Overview, Settings → Joining.

/** Rules summary (About): numbered one-liners and "Read the full Code of conduct". */
export function RulesSummary({ orgId, base }: { orgId: string; base: string }) {
  const q = useQuery({ queryKey: ["community-rules", orgId], queryFn: () => readCommunityRulesAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d?.rules.length) return null;
  return (
    <RailSection title="Code of conduct">
      <ol className="list-decimal space-y-1 pl-5 text-[13px]" data-testid="rules-summary">{d.rules.map((r) => <li key={r.n} value={r.n}>{r.text}</li>)}</ol>
      {d.slug ? <Link href={`${base}?tab=docs&doc=${encodeURIComponent(d.slug)}`} className="nb-link mt-2 inline-block text-[13px]">Read the full Code of conduct</Link> : null}
    </RailSection>
  );
}

/** I agree (Overview): the first time, and again when the Code of conduct changes — reading isn't blocked. */
export function CommunityFrontDoor({ orgId, base }: { orgId: string; base: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["my-community", orgId], queryFn: () => readMyCommunityAction(orgId), staleTime: 30_000 });
  const [checked, setChecked] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => void client.invalidateQueries({ queryKey: ["my-community", orgId] });
  const agree = async () => { const r = await agreeToCodeAction(orgId); if (!r.success) return void toast.error(r.error); toast.success("Thanks — welcome in"); refresh(); };
  const tick = async (id: string) => { setTicked([...ticked, id]); const r = await tickGettingStartedAction(orgId, id); if (!r.success) { setTicked(ticked); return void toast.error(r.error); } refresh(); };
  return (
    <>
      {d.agree ? (
        <OrgCard title={d.agree.again ? "The Code of conduct changed" : "Before you post: the Code of conduct"} testId="agree-card">
          <div className="space-y-2 text-[13px]">
            {d.agree.again ? <p className="text-muted-foreground">Keep reading as usual; agree to post again.</p> : null}
            {d.agree.rules.length ? <ol className="list-decimal space-y-1 pl-5">{d.agree.rules.map((r) => <li key={r.n} value={r.n}>{r.text}</li>)}</ol> : null}
            <Link href={`${base}?tab=docs&doc=${encodeURIComponent(d.agree.slug)}`} className="nb-link inline-block">Read the full Code of conduct</Link>
            <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I agree to the Code of conduct</label>
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!checked} onClick={() => void agree()}>Continue</button>
          </div>
        </OrgCard>
      ) : null}
      {d.gettingStarted ? (
        <OrgCard title={`Getting started · ${d.gettingStarted.items.filter((i) => i.done || ticked.includes(i.id)).length} of ${d.gettingStarted.items.length}`} testId="getting-started">
          <ul className="space-y-1.5 text-[13px]">
            {d.gettingStarted.items.map((i) => ({ ...i, done: i.done || ticked.includes(i.id) })).map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <input type="checkbox" className="nb-check" checked={i.done} disabled={i.done || i.auto} aria-label={`Done: ${i.label}`} onChange={() => void tick(i.id)} />
                <Link href={i.href.startsWith("?") ? `${base}${i.href}` : i.href} className={i.done ? "text-muted-foreground line-through" : "hover:underline"}>{i.label}</Link>
              </li>
            ))}
          </ul>
        </OrgCard>
      ) : null}
    </>
  );
}

const slug = (s: string, i: number) => (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "item") + `-${i}`;

/** Settings → Joining (organisers). */
export function JoiningSettings({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["joining-settings", orgId], queryFn: () => readJoiningSettingsAction(orgId), staleTime: 60_000 });
  const [s, setS] = useState<CommunitySettings | null>(null);
  const d = q.data?.success ? q.data.settings : null;
  if (!d) return null;
  const v = s ?? d;
  const save = async () => {
    const payload = { ...v, questions: v.questions.filter((x) => x.label.trim()).map((x, i) => ({ id: x.id || slug(x.label, i), label: x.label })),
      gettingStarted: v.gettingStarted.filter((x) => x.label.trim()).map((x, i) => ({ ...x, id: x.id || slug(x.label, i) })) };
    const r = await saveJoiningSettingsAction(orgId, payload);
    if (!r.success) return void toast.error(r.error);
    toast.success("Joining saved");
    setS(null);
    void client.invalidateQueries({ queryKey: ["joining-settings", orgId] });
  };
  const box = (key: "agreeRequired" | "welcomePost" | "firstDayLimit", label: string) =>
    <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={v[key]} onChange={(e) => setS({ ...v, [key]: e.target.checked })} />{label}</label>;
  return (
    <SettingsCard title="Code of conduct and first days" headingLevel={2} description="How people join: agreeing to the Code of conduct, up to 3 join questions, and a short Getting started list for the first 14 days.">
      <div className="space-y-3 text-[13px]" data-testid="joining-settings">
        {box("agreeRequired", "Agree to the Code of conduct before joining")}
        <fieldset className="space-y-1.5"><legend className="font-medium">Join questions <span className="font-normal text-muted-foreground">(optional to answer in instant join; required when you approve joins)</span></legend>
          {v.questions.map((x, i) => <span key={i} className="flex gap-2"><Input value={x.label} maxLength={200} aria-label={`Join question ${i + 1}`} onChange={(e) => setS({ ...v, questions: v.questions.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} className="flex-1" />
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setS({ ...v, questions: v.questions.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> question {i + 1}</span></button></span>)}
          {v.questions.length < 3 ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setS({ ...v, questions: [...v.questions, { id: "", label: "" }] })}>Add a question</button> : null}
        </fieldset>
        <fieldset className="space-y-1.5"><legend className="font-medium">Getting started <span className="font-normal text-muted-foreground">(up to 5; shown for 14 days; no reminders)</span></legend>
          {v.gettingStarted.map((x, i) => <span key={i} className="flex flex-wrap gap-2">
            <Input value={x.label} maxLength={120} aria-label={`Getting started item ${i + 1}`} onChange={(e) => setS({ ...v, gettingStarted: v.gettingStarted.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} className="min-w-[220px] flex-1" />
            <Input value={x.href} maxLength={300} aria-label={`Link for item ${i + 1}`} onChange={(e) => setS({ ...v, gettingStarted: v.gettingStarted.map((y, j) => (j === i ? { ...y, href: e.target.value } : y)) })} className="w-[200px] font-mono" />
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setS({ ...v, gettingStarted: v.gettingStarted.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> item {i + 1}</span></button></span>)}
          {v.gettingStarted.length < 5 ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setS({ ...v, gettingStarted: [...v.gettingStarted, { id: "", label: "", href: "?tab=docs" }] })}>Add an item</button> : null}
        </fieldset>
        {box("welcomePost", "Post a welcome in a channel when someone joins")}
        {box("firstDayLimit", "For their first 24 hours, new members can’t start direct messages with people they haven’t talked to")}
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save joining</button>
      </div>
    </SettingsCard>
  );
}
