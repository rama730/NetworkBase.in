"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readPeerReviewAction, savePeerReviewAction, startPeerReviewsAction } from "@/app/actions/peer-review";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import type { Rubric } from "@/lib/organizations/marks";
import { webLink } from "@/lib/organizations/assignment-rules";
import { cn } from "@/lib/utils";

// Report 30.8 call (plan B1.5c): peer review in the student's hand-in. Names hidden both ways; feedback, not marks.
const LABEL = "font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground";
const levelsText = (rubric: Rubric, levels: Record<string, number>) => rubric.criteria.map((c) => `${c.name} ${levels[c.id] != null ? c.levels[levels[c.id]!]?.label ?? "—" : "—"}`).join(" · ");

export function PeerReviewCard({ copyId }: { copyId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["peer-review", copyId], queryFn: () => readPeerReviewAction(copyId), staleTime: 30_000 });
  const data = q.data?.success && q.data.on ? q.data : null;
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const refresh = () => client.invalidateQueries({ queryKey: ["peer-review", copyId] });
  const start = async () => {
    setBusy(true);
    const r = await startPeerReviewsAction(copyId);
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    await refresh();
  };
  const left = data.todo.filter((t) => !t.submitted).length;
  return (
    <section aria-label="Peer review" className="space-y-3" data-testid="peer-review">
      <h4 className={LABEL}>Peer review{data.todo.length ? ` · ${data.todo.length - left} of ${data.todo.length} sent` : ""}</h4>
      {data.feedback.length ? (
        <ul className="space-y-1.5" aria-label="Feedback from classmates">
          {data.feedback.map((f) => (
            <li key={f.label} className="rounded-md bg-muted px-3 py-2 text-[13px]"><span className="font-medium">{f.label}</span> · {levelsText(data.rubric, f.levels)}
              {f.comment ? <span className="mt-0.5 block whitespace-pre-wrap">“{f.comment}”</span> : null}</li>
          ))}
        </ul>
      ) : null}
      {!data.handedIn ? <p className="text-[13px] text-muted-foreground">After you hand in, you review {data.peers} classmates’ work. Names stay hidden both ways.</p>
        : data.todo.length === 0 ? (
          <div className="space-y-1.5">
            <p className="text-[13px] text-muted-foreground">Review {data.peers} classmates’ hand-ins with the rubric. Names stay hidden both ways; it’s feedback, not a mark.</p>
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void start()}>Start peer review</button>
          </div>
        ) : data.todo.map((t) => <PeerReviewItem key={t.id} item={t} rubric={data.rubric} onSaved={refresh} />)}
    </section>
  );
}

function PeerReviewItem({ item, rubric, onSaved }: { item: { id: string; label: string; text: string | null; link: string | null; levels: Record<string, number>; comment: string | null; submitted: boolean }; rubric: Rubric; onSaved: () => void }) {
  const [levels, setLevels] = useState(item.levels);
  const [comment, setComment] = useState(item.comment ?? "");
  const save = async (submit: boolean) => {
    const r = await savePeerReviewAction(item.id, { levels, comment: comment.trim() || null, submit });
    if (!r.success) return void toast.error(r.error);
    if (submit) { toast.success("Review sent"); onSaved(); }
  };
  const link = item.link ? webLink(item.link) : null;
  return (
    <div className="space-y-2 rounded-md border border-border p-3 text-[13px]" data-testid="peer-review-item">
      <p className="font-medium">{item.label}{item.submitted ? <span className="font-normal text-muted-foreground"> · Sent</span> : null}</p>
      {item.text ? <p className="whitespace-pre-wrap rounded-md bg-muted px-2.5 py-1.5">{item.text}</p> : null}
      {link ? <a href={link} target="_blank" rel="noreferrer noopener" className="block break-all text-primary underline">{item.link}</a> : null}
      {rubric.criteria.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>{c.name}</span>
          <span role="radiogroup" aria-label={`${item.label}: ${c.name}`} className="flex gap-1">
            {c.levels.map((l, i) => (
              <button key={l.label} type="button" role="radio" aria-checked={levels[c.id] === i} disabled={item.submitted} title={l.text || undefined}
                onClick={() => setLevels({ ...levels, [c.id]: i })}
                className={cn("nb-touch-target rounded-sm border border-border px-2 py-1 text-[12px]", levels[c.id] === i ? "bg-foreground font-semibold text-background" : "bg-card hover:bg-muted")}>{l.label}</button>
            ))}
          </span>
        </div>
      ))}
      <textarea className="nb-textarea" rows={2} aria-label={`${item.label}: feedback`} placeholder="What works, and one thing to improve" value={comment} disabled={item.submitted}
        onChange={(e) => setComment(e.target.value)} onBlur={() => { if (!item.submitted) void save(false); }} />
      {item.submitted ? null : <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save(true)}>Send review</button>}
    </div>
  );
}
