"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Vote } from "lucide-react";

import { createGroupPollAction, pickGroupPollAction, readGroupPollsAction, voteGroupPollAction } from "@/app/actions/community-groups";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 34.6 (plan B5.5c, call 10): a small group's Poll on its Overview — choose a time or an option; ticks with counts
// and who ticked (members only); the starter or a host picks. Hidden on any workspace that isn't a community group.
export function GroupPolls({ groupId }: { groupId: string }) {
  const q = useQuery({ queryKey: ["group-polls", groupId], queryFn: () => readGroupPollsAction(groupId), staleTime: 30_000 });
  const [making, setMaking] = useState(false);
  // Optimistic ticks: the box changes at once; the refetch settles it.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  if (!q.data?.success || !q.data.isGroup) return null;
  const { polls } = q.data;
  const tick = async (pollId: string, option: number, on: boolean) => {
    setLocal((x) => ({ ...x, [`${pollId}:${option}`]: on }));
    const r = await voteGroupPollAction(groupId, pollId, option, on);
    if (!r.success) { toast.error(r.error); setLocal((x) => ({ ...x, [`${pollId}:${option}`]: !on })); }
    void q.refetch();
  };
  const pick = async (pollId: string, option: number) => {
    const r = await pickGroupPollAction(groupId, pollId, option);
    if (!r.success) return void toast.error(r.error);
    toast.success("Picked. The group has been told.");
    void q.refetch();
  };
  const open = polls.filter((p) => p.open || p.picked !== null).slice(0, 3);
  return (
    <section aria-label="Polls" className="mb-4 space-y-2 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="group-polls">
      <div className="flex items-center gap-2"><Vote className="size-4" aria-hidden="true" /><h3 className="font-medium">Polls</h3>
        <button type="button" className={`${FORM_SECONDARY_CLASS} ml-auto`} onClick={() => setMaking(!making)}>{making ? "Cancel" : "New poll"}</button></div>
      {making ? <NewPoll groupId={groupId} onDone={() => { setMaking(false); void q.refetch(); }} /> : null}
      {open.length ? open.map((p) => {
        const max = Math.max(1, ...p.options.map((o) => o.count));
        return (
          <div key={p.id} className="space-y-1.5 border-t border-border pt-2" data-testid="group-poll">
            <p className="font-medium">{p.question} {p.picked !== null ? <StatusBadge state="active">Picked: {p.options[p.picked]?.label}</StatusBadge> : null}</p>
            <ul className="space-y-1">{p.options.map((o, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-[150px] items-center gap-2"><input type="checkbox" className="nb-check" checked={local[`${p.id}:${i}`] ?? o.mine} disabled={!p.open} onChange={(x) => void tick(p.id, i, x.target.checked)} />{o.label}</label>
                <span aria-hidden="true" className="h-2 rounded-sm bg-primary" style={{ width: `${Math.round((o.count / max) * 120)}px` }} />
                <span className="font-mono">{o.count}</span>
                {o.who.length ? <span className="text-muted-foreground">{o.who.join(", ")}</span> : null}
                {p.open && p.canPick ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void pick(p.id, i)}>Pick</button> : null}
              </li>))}</ul>
            {p.open ? <p className="text-muted-foreground">Closes {new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(p.closesAt))}</p> : null}
          </div>
        );
      }) : !making ? <p className="text-muted-foreground">No open polls. Ask the group when to meet, or what to read next.</p> : null}
    </section>
  );
}

function NewPoll({ groupId, onDone }: { groupId: string; onDone: () => void }) {
  const tomorrow = new Date(Date.now() + 2 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const [f, setF] = useState({ question: "", kind: "times" as "times" | "options", options: ["", "", ""], closes: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T20:00` });
  const save = async () => {
    const r = await createGroupPollAction(groupId, { question: f.question.trim(), kind: f.kind, options: f.options.map((o) => o.trim()).filter(Boolean), closesAt: new Date(f.closes).toISOString() });
    if (!r.success) return void toast.error(r.error);
    toast.success("Poll started. The group has been told.");
    onDone();
  };
  return (
    <fieldset className="space-y-2" data-testid="new-poll">
      <legend className="sr-only">New poll</legend>
      <Input value={f.question} maxLength={200} placeholder="When should we meet?" aria-label="Question" onChange={(x) => setF({ ...f, question: x.target.value })} />
      <span className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="pollkind" checked={f.kind === "times"} onChange={() => setF({ ...f, kind: "times" })} />Times</label>
        <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="pollkind" checked={f.kind === "options"} onChange={() => setF({ ...f, kind: "options" })} />Options</label>
      </span>
      {f.options.map((o, i) => <Input key={i} value={o} maxLength={80} placeholder={f.kind === "times" ? "Tue 20:00" : "An option"} aria-label={`Choice ${i + 1}`} onChange={(x) => setF({ ...f, options: f.options.map((y, j) => (j === i ? x.target.value : y)) })} />)}
      {f.options.length < 5 ? <button type="button" className="nb-link" onClick={() => setF({ ...f, options: [...f.options, ""] })}>Add a choice</button> : null}
      <label className="flex flex-wrap items-center gap-2">Closes<Input type="datetime-local" value={f.closes} onChange={(x) => setF({ ...f, closes: x.target.value })} className="w-[210px] font-mono" /></label>
      <button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.question.trim() || f.options.filter((o) => o.trim()).length < 2} onClick={() => void save()}>Start poll</button>
    </fieldset>
  );
}
