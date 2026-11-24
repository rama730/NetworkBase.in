"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Trash2 } from "@/components/ui/icons";

import { feedbackError, toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { formatDistanceToNow } from "@/lib/utils/date";

type Note = { id: string; note: string; agentName: string | null; createdAt: string };

/**
 * Report D16 (0089): where an agent stopped on this task, so its next session carries on. The person reads them
 * here and deletes any they don't want kept. Nothing shows until an agent leaves one.
 */
export function AgentNotes({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const key = queryKeys.project.detail.taskPanel(projectId, taskId, "agent-notes");
  const notes = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Note[]> => {
      const res = await fetch(`/api/v1/tasks/${taskId}/agent-notes`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      return res.ok && body?.success ? (body.data.notes as Note[]) : [];
    },
    staleTime: 60_000,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/tasks/${taskId}/agent-notes`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.message ?? "Couldn’t delete the note");
    },
    onSuccess: (_d, id) => queryClient.setQueryData<Note[]>(key, (old) => (old ?? []).filter((n) => n.id !== id)),
    onError: (error, id) => toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t delete the note", "Couldn’t delete the note"), { retry: () => remove.mutate(id) }),
  });

  if (!notes.data?.length) return null;
  return (
    <section aria-labelledby={`agent-notes-${taskId}`} className="space-y-2 border-t border-border pt-3">
      <h3 id={`agent-notes-${taskId}`} className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Agent notes</h3>
      <p className="text-[12px] text-muted-foreground">Where an agent stopped. Its next session starts from these.</p>
      <ul className="space-y-1.5">
        {notes.data.map((n) => (
          <li key={n.id} className="group flex items-start gap-2 rounded-[5px] border border-border bg-muted/10 px-3 py-2">
            <Bot className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words text-[13px] text-foreground">{n.note}</p>
              <p className="text-[11px] text-muted-foreground">
                {n.agentName ?? "An AI agent"} · {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove.mutate(n.id)}
              disabled={remove.isPending}
              className="nb-touch-target inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label={`Delete the note from ${n.agentName ?? "an AI agent"}`}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
