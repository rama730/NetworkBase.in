"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getWorkspaceAgentSettingsAction, updateWorkspaceAgentSettingsAction } from "@/app/actions/workspace/agents";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { feedbackError, toast } from "@/lib/feedback";

type Policy = "ask_important" | "ask_all" | "trust_drafts_docs";

const POLICIES: Array<{ value: Policy; label: string; help: string }> = [
  { value: "ask_important", label: "Ask for important changes", help: "Agents create tasks, comment, tick subtasks and push drafts right away, each with Undo. Final files, finishing tasks, doc edits, moving or deleting files, and anything on someone else's task wait for the person's yes." },
  { value: "ask_all", label: "Ask for everything", help: "Every change an agent makes waits for the person's yes. For classes and sensitive work." },
  { value: "trust_drafts_docs", label: "Trust agents with drafts and docs", help: "Like the first, but README and doc edits run right away too. Final files, finishing and deleting still ask." },
];

const key = (projectId: string) => ["project", projectId, "agent-settings"] as const;

/** Workspace settings → AI agents (report §26.6, §18.5): the policy and the "Pause agents" switch. */
export function AgentSettings({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: key(projectId),
    staleTime: 30_000,
    queryFn: async () => {
      const result = await getWorkspaceAgentSettingsAction(projectId);
      if (!result.success) throw new Error(result.error);
      return result;
    },
  });
  const [saving, setSaving] = useState(false);

  async function save(change: { policy?: Policy; paused?: boolean }) {
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateWorkspaceAgentSettingsAction({ projectId, ...change });
      if (!result.success) throw new Error(result.error);
      client.setQueryData(key(projectId), result);
      toast.success(change.paused === true ? "Agents are paused here" : change.paused === false ? "Agents can work here again" : "Agent setting saved");
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t save agent settings", "Couldn’t save agent settings"));
      void settings.refetch();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title="AI agents" description="What Claude Code, Codex and other agents signed in to this workspace may change without asking.">
      {settings.isPending ? (
        <p role="status" className="nb-compact text-muted-foreground">Loading agent settings…</p>
      ) : settings.isError ? (
        <p role="alert" className="nb-compact text-destructive">
          Couldn’t load agent settings.{" "}
          <button type="button" className="underline" onClick={() => void settings.refetch()}>Retry</button>
        </p>
      ) : (
        <div className="space-y-5">
          <fieldset className="space-y-3" disabled={saving}>
            <legend className="sr-only">Agent policy</legend>
            {POLICIES.map((p) => (
              <label key={p.value} className="flex items-start gap-2.5">
                <input type="radio" className="nb-radio mt-0.5" name={`agent-policy-${projectId}`} checked={settings.data.policy === p.value} onChange={() => void save({ policy: p.value })} />
                <span className="space-y-0.5">
                  <span className="nb-compact block font-medium">{p.label}</span>
                  <span className="nb-compact block text-muted-foreground">{p.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-start justify-between gap-6 border-t border-border pt-4">
            <div className="space-y-1">
              <label htmlFor={`agents-paused-${projectId}`} className="nb-compact font-medium">Pause agents</label>
              <p id={`agents-paused-help-${projectId}`} className="nb-compact text-muted-foreground">
                Stops every agent request in this workspace at once, reads included. People and their own CLI keep working.
              </p>
            </div>
            <SettingsSwitch
              id={`agents-paused-${projectId}`}
              aria-describedby={`agents-paused-help-${projectId}`}
              checked={settings.data.paused}
              disabled={saving}
              onCheckedChange={(paused: boolean) => void save({ paused })}
            />
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
