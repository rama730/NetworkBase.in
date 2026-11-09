"use client";

import { useState } from "react";

import { readAgentActivityAction, type AgentActivity as Activity } from "@/app/actions/agent-activity";
import { Button } from "@/components/ui/button";
import { feedbackError, toast } from "@/lib/feedback";
import { formatDistanceToNow } from "@/lib/utils/date";

/** An agent's recent changes with Undo, and its questions (CLI report A11.7). Loads when opened. */
export function AgentActivity({ sessionId }: { sessionId: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const load = () => void readAgentActivityAction(sessionId).then((r) => (r.success ? setActivity(r.activity) : toast.error(r.error)));
  const undo = async (id: string) => {
    setUndoing(id);
    try {
      const res = await fetch(`/api/v1/undo/${id}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: "{}" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? "Couldn’t undo that");
      toast.success(`Undone: ${body?.data?.undone ?? "the change"}`);
      load();
    } catch (error) {
      toast.error(feedbackError(error, "Couldn’t undo that"));
    } finally {
      setUndoing(null);
    }
  };
  return (
    <details className="mt-2" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !activity) load(); }}>
      <summary className="cursor-pointer nb-meta text-muted-foreground hover:text-foreground">Activity</summary>
      {!activity ? <div role="status" aria-label="Loading activity" className="nb-skeleton mt-2 h-12 rounded-md" /> : (
        <div className="mt-2 space-y-2">
          {activity.changes.length === 0 && activity.questions.length === 0 ? <p className="nb-compact text-muted-foreground">Nothing in the last 7 days.</p> : null}
          {activity.changes.length ? (
            <ul className="divide-y divide-border rounded-md border border-border" aria-label="Changes">
              {activity.changes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 nb-compact">
                  <span className="min-w-0"><span className="block truncate text-foreground">{c.summary}</span>
                    <span className="nb-meta text-muted-foreground">{c.workspace ?? "A workspace"} · {formatDistanceToNow(new Date(c.at), { addSuffix: true })}</span></span>
                  {c.undoable ? <Button size="sm" variant="outline" disabled={undoing === c.id} onClick={() => void undo(c.id)}>Undo</Button> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {activity.questions.length ? (
            <ul className="space-y-1" aria-label="Questions">
              {activity.questions.map((q) => (
                <li key={q.id} className="nb-compact text-muted-foreground">Asked {formatDistanceToNow(new Date(q.at), { addSuffix: true })}{q.context ? `: ${q.context}` : ""} · {q.status}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </details>
  );
}
