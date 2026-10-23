"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast, feedbackError } from "@/lib/feedback";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { SettingsCard } from "@/components/projects/settings/SettingsFormFields";
import {
  taskCompletionPolicyKey,
  useTaskCompletionPolicy,
} from "@/hooks/useTaskCompletionPolicy";
import { updateTaskCompletionPolicyAction } from "@/app/actions/project/task-completion";

export function TaskCompletionSettings({ projectId }: { projectId: string }) {
  const policy = useTaskCompletionPolicy(projectId);
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  async function save(reviewRequired: boolean) {
    if (!policy.data || saving) return;
    setSaving(true);
    try {
      const result = await updateTaskCompletionPolicyAction({
        projectId,
        reviewRequired,
        expectedVersion: policy.data.version,
      });
      if (!result.success) throw new Error(result.error);
      client.setQueryData(taskCompletionPolicyKey(projectId), {
        ...policy.data,
        ...result,
      });
      toast.success(
        reviewRequired
          ? "Task completion now requires review"
          : "Tasks can now be completed directly",
      );
    } catch (error) {
      toast.error(
        feedbackError(error instanceof Error
          ? error.message
          : "Unable to save completion settings", "Unable to save completion settings"),
      );
      void policy.refetch();
    } finally {
      setSaving(false);
    }
  }
  return (
    <SettingsCard
      title="Task completion"
      description="Choose whether completed work needs a project lead’s approval."
    >
      {policy.isPending ? (
        <p role="status" className="nb-compact text-muted-foreground">
          Loading completion settings…
        </p>
      ) : policy.isError ? (
        <p role="alert" className="nb-compact text-destructive">
          Unable to load completion settings.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void policy.refetch()}
          >
            Retry
          </button>
        </p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <label
                htmlFor="task-completion-review"
                className="nb-compact font-medium"
              >
                Require review before completing tasks
              </label>
              <p
                id="task-completion-review-help"
                className="nb-compact text-muted-foreground"
              >
                Off: marking a task as done completes it immediately. On: it
                enters In review until a project owner or co-leader approves it.
              </p>
            </div>
            <SettingsSwitch
              id="task-completion-review"
              showLabel
              checked={policy.data?.reviewRequired ?? false}
              disabled={!policy.data?.canManage || policy.isPending || saving}
              aria-describedby="task-completion-review-help"
              onCheckedChange={(checked) => void save(checked)}
            />
          </div>
          <p
            className="nb-meta mt-4 border-t border-border pt-4 text-muted-foreground"
            aria-live="polite"
          >
            {saving
              ? "Saving…"
              : policy.isPending
                ? "Loading settings…"
                : "Applies to future completion attempts across the app and extension. Existing pending reviews still need a decision; completed tasks stay complete. File publishing is separate."}
          </p>
        </>
      )}
    </SettingsCard>
  );
}
