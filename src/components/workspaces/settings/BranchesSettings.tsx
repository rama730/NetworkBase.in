"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getProtectionAction, setProtectionAction } from "@/app/actions/files/merge-requests";
import { branchesSettingAction, setBranchesEnabledAction } from "@/app/actions/files/saves";
import { useStepUp } from "@/components/trust/StepUp";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { feedbackError, toast } from "@/lib/feedback";

const key = (projectId: string) => ["project", projectId, "branches-setting"] as const;

/** Workspace settings → Files → History (report H16): every change to the files becomes a save you can open and revert. */
export function BranchesSettings({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const setting = useQuery({
    queryKey: key(projectId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await branchesSettingAction(projectId);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const [saving, setSaving] = useState(false);
  if (!setting.data?.canChange) return null;
  async function change(enabled: boolean) {
    setSaving(true);
    try {
      const res = await setBranchesEnabledAction(projectId, enabled);
      if (!res.success) throw new Error(res.error);
      client.setQueryData(key(projectId), { ...setting.data!, enabled });
      void client.invalidateQueries({ queryKey: ["files-history-enabled", projectId] });
      void client.invalidateQueries({ queryKey: ["project", projectId, "protection"] });
      toast.success(enabled ? "History is on: every change to the files is a save" : "History is off; what's recorded stays");
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t change History"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <SettingsCard title="History" headingLevel={2} description="Every change to the files becomes a save: who changed what and when, with Revert. Branches build on it.">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <label htmlFor={`branches-${projectId}`} className="nb-compact font-medium">Keep a history of every change</label>
          <p id={`branches-help-${projectId}`} className="nb-compact text-muted-foreground">
            Also turns on change sets. Turning it off keeps what&apos;s recorded. <a href="/docs/files/branches" className="underline underline-offset-2 hover:text-foreground">What&apos;s this?</a>
          </p>
        </div>
        <SettingsSwitch id={`branches-${projectId}`} aria-describedby={`branches-help-${projectId}`} checked={setting.data.enabled} disabled={saving} onCheckedChange={(on: boolean) => void change(on)} />
      </div>
    </SettingsCard>
  );
}

/** History, then main's protection once history is on (H5 builds on it). */
export function FilesHistorySettings({ projectId }: { projectId: string }) {
  const setting = useQuery({ queryKey: key(projectId), staleTime: 30_000, queryFn: async () => { const res = await branchesSettingAction(projectId); if (!res.success) throw new Error(res.error); return res.data; } });
  return (
    <>
      <BranchesSettings projectId={projectId} />
      {setting.data?.enabled ? <ProtectMainSettings projectId={projectId} /> : null}
    </>
  );
}

type Rules = { requireMergeRequest: boolean; approvals: number; reapproveOnNewSaves: boolean; requiredChecks: string[]; mergeBy: "writers" | "admins"; agentsOnBranches: boolean; allowGithubSync: boolean };
const protectionKey = (projectId: string) => ["project", projectId, "protection"] as const;
const selectClass = "h-8 rounded-[5px] border border-border bg-card px-2 text-xs text-foreground focus:border-[#D14E24] focus:outline-none";

/**
 * Workspace settings → Files → Protect main (report H5): main changes only through merge requests, with approvals,
 * checks and who may merge; agents work on branches. Loosening a rule asks "Verify it's you" first.
 */
export function ProtectMainSettings({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: protectionKey(projectId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await getProtectionAction(projectId);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const [saving, setSaving] = useState(false);
  const [checks, setChecks] = useState<string | null>(null);
  const { needs: needsStepUp, dialog } = useStepUp("Loosening main’s protection lets changes in with less review, so confirm it’s you first.");
  const data = query.data;
  if (!data?.canChange) return null;
  const rules = data.rules as Rules;
  async function change(patch: Partial<Rules>, done: string) {
    setSaving(true);
    try {
      const res = await setProtectionAction(projectId, patch);
      if (needsStepUp(res as never, () => void change(patch, done))) return;
      if (!res.success) throw new Error(res.error);
      client.setQueryData(protectionKey(projectId), { ...data!, rules: res.data.rules });
      toast.success(done);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t change main’s protection"));
    } finally {
      setSaving(false);
    }
  }
  const row = (id: string, label: string, help: string, control: React.ReactNode) => (
    <div className="flex items-start justify-between gap-6 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <label htmlFor={`${id}-${projectId}`} className="nb-compact font-medium">{label}</label>
        <p id={`${id}-help-${projectId}`} className="nb-compact text-muted-foreground">{help}</p>
      </div>
      {control}
    </div>
  );
  const on = rules.requireMergeRequest;
  return (
    <SettingsCard title="Protect main" headingLevel={2} description="Main is what everyone sees. Protected, it changes only through reviewed merge requests.">
      <div className="space-y-3">
        {row("protect", "Change main only through merge requests", "Edits, uploads and pushes to main go to a new branch with a merge request instead.",
          <SettingsSwitch id={`protect-${projectId}`} aria-describedby={`protect-help-${projectId}`} checked={on} disabled={saving}
            onCheckedChange={(v: boolean) => void change(v ? { requireMergeRequest: true, approvals: Math.max(rules.approvals, 1) } : { requireMergeRequest: false }, v ? "main is protected" : "main takes direct changes again")} />)}
        {on ? (
          <>
            {row("approvals", "Approvals needed", "Reviews that approve before it can merge. You can’t approve your own.",
              <select id={`approvals-${projectId}`} aria-describedby={`approvals-help-${projectId}`} className={selectClass} value={rules.approvals} disabled={saving}
                onChange={(e) => void change({ approvals: Number(e.target.value) }, "Saved")}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>)}
            {row("reapprove", "New saves need approval again", "An approval counts only for the branch’s latest save.",
              <SettingsSwitch id={`reapprove-${projectId}`} aria-describedby={`reapprove-help-${projectId}`} checked={rules.reapproveOnNewSaves} disabled={saving} onCheckedChange={(v: boolean) => void change({ reapproveOnNewSaves: v }, "Saved")} />)}
            {row("checks", "Checks that must pass", "Names your build posts (nb merge-request check), separated by commas. Empty for none.",
              <input id={`checks-${projectId}`} aria-describedby={`checks-help-${projectId}`} className={`${selectClass} w-44 font-mono`} placeholder="build, test" disabled={saving}
                value={checks ?? rules.requiredChecks.join(", ")} onChange={(e) => setChecks(e.target.value)}
                onBlur={() => { if (checks === null) return; const list = checks.split(",").map((c) => c.trim()).filter(Boolean); setChecks(null); if (list.join(",") !== rules.requiredChecks.join(",")) void change({ requiredChecks: list }, "Saved"); }} />)}
            {row("merge-by", "Who may merge", "Everyone who can change files, or only owners and admins.",
              <select id={`merge-by-${projectId}`} aria-describedby={`merge-by-help-${projectId}`} className={selectClass} value={rules.mergeBy} disabled={saving}
                onChange={(e) => void change({ mergeBy: e.target.value as Rules["mergeBy"] }, "Saved")}>
                <option value="writers">Everyone with write access</option>
                <option value="admins">Owners and admins</option>
              </select>)}
            {row("github", "GitHub sync may update main", "A connected repository stays the source of truth for main; its changes arrive as saves “from GitHub”.",
              <SettingsSwitch id={`github-${projectId}`} aria-describedby={`github-help-${projectId}`} checked={rules.allowGithubSync} disabled={saving} onCheckedChange={(v: boolean) => void change({ allowGithubSync: v }, "Saved")} />)}
          </>
        ) : null}
        {row("agents", "Agents work on a branch", data.agentsLocked ? "Always on in a team workspace: an agent’s changes come to you as a merge request." : "An agent’s changes come to you as a merge request instead of landing on main.",
          <SettingsSwitch id={`agents-${projectId}`} aria-describedby={`agents-help-${projectId}`} checked={rules.agentsOnBranches} disabled={saving || (data.agentsLocked && rules.agentsOnBranches)} onCheckedChange={(v: boolean) => void change({ agentsOnBranches: v }, "Saved")} />)}
      </div>
      {dialog}
    </SettingsCard>
  );
}
