"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { branchesSettingAction, setBranchesEnabledAction } from "@/app/actions/files/saves";
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
