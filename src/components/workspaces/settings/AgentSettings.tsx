"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getWorkspaceAgentSettingsAction, updateWorkspaceAgentSettingsAction } from "@/app/actions/workspace/agents";
import type { LabelSetting } from "@/lib/agents/via-visibility";
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

const LABEL_CHOICES: { value: LabelSetting; label: string; help: string }[] = [
  { value: "everyone", label: "Everyone", help: "Everyone who can see the work sees which agent helped." },
  { value: "person", label: "Only the person", help: "Only the person who used the agent sees it, on their own work." },
  { value: "none", label: "No one", help: "Hidden for everyone. Agent activity, Undo and Pause agents still work." },
];

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

  /** `inline`: called by a switch, which shows success itself and a failure beside it (controls round 2). */
  async function save(change: { policy?: Policy; paused?: boolean; labels?: LabelSetting; membersChooseLabels?: boolean }, inline = false) {
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateWorkspaceAgentSettingsAction({ projectId, ...change });
      if (!result.success) throw new Error(result.error);
      client.setQueryData(key(projectId), (old: typeof settings.data) => (old ? { ...old, ...result } : old));
      if (!inline) toast.success(change.paused === true ? "Agents are paused here" : change.paused === false ? "Agents can work here again" : "Agent setting saved");
    } catch (error) {
      void settings.refetch();
      if (inline) throw error;
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t save agent settings", "Couldn’t save agent settings"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title="AI agents" description="What Claude Code, Codex and other agents signed in to this workspace may change without asking.">
      {settings.isPending ? (
        <p role="status" className="nb-waiting nb-compact text-muted-foreground"><PixelBeat />Loading agent settings…</p>
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
              onCheckedChange={(paused: boolean) => save({ paused }, true)}
            />
          </div>
          <div className="border-t border-border pt-4">
          <fieldset className="space-y-3" disabled={saving || !settings.data.canChangeLabels} aria-describedby={`agent-labels-help-${projectId}`}>
            <legend className="nb-compact font-medium">Show when agents helped</legend>
            <p id={`agent-labels-help-${projectId}`} className="nb-compact text-muted-foreground">
              Work stays under the person who did it, with &ldquo;with Claude Code&rdquo; after their name.
              {settings.data.inOrganization ? " Where an assignment asks for AI to be labelled, its teachers and reviewers still see it." : ""}
              {settings.data.canChangeLabels ? "" : " Only the workspace owner can change this."}
            </p>
            {LABEL_CHOICES.map((c) => (
              <label key={c.value} className="flex items-start gap-2.5">
                <input type="radio" className="nb-radio mt-0.5" name={`agent-labels-${projectId}`} checked={settings.data.labels === c.value} onChange={() => void save({ labels: c.value })} />
                <span className="space-y-0.5">
                  <span className="nb-compact block font-medium">{c.label}</span>
                  <span className="nb-compact block text-muted-foreground">{c.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {settings.data.labels !== "none" ? (
            <div className="mt-4 flex items-start justify-between gap-6">
              <div className="space-y-1">
                <label htmlFor={`members-choose-${projectId}`} className="nb-compact font-medium">Let members choose</label>
                <p id={`members-choose-help-${projectId}`} className="nb-compact text-muted-foreground">
                  Each member may hide &ldquo;with Claude Code&rdquo; on their own work, in their own settings. They can only hide it, never show more.
                </p>
              </div>
              <SettingsSwitch id={`members-choose-${projectId}`} aria-describedby={`members-choose-help-${projectId}`} checked={settings.data.membersChooseLabels} disabled={saving || !settings.data.canChangeLabels}
                onCheckedChange={(membersChooseLabels: boolean) => save({ membersChooseLabels }, true)} />
            </div>
          ) : null}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
