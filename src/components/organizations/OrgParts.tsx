"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { addKitPartsAction, readPartsAction, setPartAction } from "@/app/actions/org-parts";
import { StatusBadge } from "@/components/organizations/org-ui";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

/**
 * Settings → Workflows (B8.4a, report 37.2 call 5): the parts an Other organization can switch on, On or Off ("has data"
 * when off: turning it on brings it back), and Add from a kit. Turning a part off hides it and never deletes anything.
 */
export function OrgPartsSettings({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["org-parts", orgId], queryFn: () => readPartsAction(orgId), staleTime: 60_000 });
  const [kit, setKit] = useState("");
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => {
    const r = await x.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
    if (!r.success) return void toast.error(r.error ?? "Couldn’t save that.");
    toast.success(ok);
    void q.refetch();
    void client.invalidateQueries({ queryKey: ["volunteers", orgId] });
    void client.invalidateQueries({ queryKey: ["programs", orgId] });
    void client.invalidateQueries({ queryKey: ["fixed-time", orgId] });
  };
  return (
    <SettingsCard title="Workflows" headingLevel={2} description="Switch parts on as you need them. Turning one off hides it and keeps its data; turning it on again brings everything back.">
      <div className="space-y-3 text-[13px]" data-testid="org-parts">
        <ul className="divide-y divide-border rounded-md border border-border">{d.parts.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="org-part">
            <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span> <span className="text-muted-foreground">· {p.line} · on {p.where}</span></span>
            <StatusBadge state={p.on ? "active" : "draft"}>{p.on ? "On" : p.hasData ? "Off · has data" : "Off"}</StatusBadge>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(setPartAction(orgId, p.id, !p.on), p.on ? `${p.name} is off; its data is kept` : `${p.name} is on`)}>
              {p.on ? "Turn off" : "Turn on"}<span className="sr-only"> {p.name}</span></button>
          </li>))}</ul>
        {d.kits.length ? <span className="flex flex-wrap items-center gap-2">
          <select className="nb-select" aria-label="Add from a kit" value={kit} onChange={(e) => setKit(e.target.value)}>
            <option value="">Add from a kit…</option>{d.kits.map((k) => <option key={k.id} value={k.id}>{k.name}: {k.parts.join(", ")}</option>)}</select>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!kit} onClick={() => void run(addKitPartsAction(orgId, kit), "Added").then(() => setKit(""))}>Add</button></span> : null}
      </div>
    </SettingsCard>
  );
}
