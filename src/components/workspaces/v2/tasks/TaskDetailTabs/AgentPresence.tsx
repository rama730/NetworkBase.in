"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "@/components/ui/icons";
import { useEffect, useState } from "react";

import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { liveTopics } from "@/lib/realtime/subscriptions";

type Agent = { agentName: string; at: string };
const TTL_MS = 90_000;

/** "Claude Code is working on this" (report D5, D17): agents send a heartbeat every minute while they work. */
export function workingLine(names: string[]) {
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} is working on this`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are working on this`;
}

export function AgentPresence({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const key = queryKeys.project.detail.taskPanel(projectId, taskId, "agent-presence");
  const agents = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Agent[]> => {
      const res = await fetch(`/api/v1/tasks/${taskId}/presence`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      return res.ok && body?.success ? (body.data.agents as Agent[]) : [];
    },
    refetchInterval: 60_000,
  });
  // An arrival comes live on the task's topic; leaving is an entry going quiet for 90 seconds.
  useEffect(() => subscribeBroadcast(liveTopics.task(taskId), (event, payload) => {
    if (event !== "agent.presence") return;
    const list = (payload as { agents?: Array<{ agentName: string; at: number }> }).agents ?? [];
    queryClient.setQueryData<Agent[]>(key, list.map((a) => ({ agentName: a.agentName, at: new Date(a.at).toISOString() })));
  }).unsubscribe, [taskId, projectId, queryClient]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const names = [...new Set((agents.data ?? []).filter((a) => now - Date.parse(a.at) < TTL_MS).map((a) => a.agentName))];
  const line = workingLine(names);
  if (!line) return null;
  return (
    <p role="status" className="flex items-center gap-1.5 rounded-[5px] border border-border bg-muted/20 px-3 py-1.5 text-[12px] text-foreground">
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-[2px] bg-emerald-500 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-[2px] bg-emerald-500" />
      </span>
      <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
      {line}
    </p>
  );
}
