"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";

import { createBranchAction } from "@/app/actions/files/branches";
import { branchNameForTask } from "@/lib/branches/names";
import { toast } from "@/lib/feedback";

/**
 * "Start work" on a task (report H2, H23 journey 2): a branch `task/4-login-bug` from main, linked to the task, and
 * Files opens on it. When the task's branch already exists, it opens that one. Shown only where Branches is on.
 */
export function StartWorkOnBranch({ projectId, task }: { projectId: string; task: { id: string; taskNumber: number | null; title: string } }) {
  const [busy, setBusy] = useState(false);
  const on = useQuery({
    queryKey: ["files-history-enabled", projectId],
    queryFn: async () => {
      const { branchesSettingAction } = await import("@/app/actions/files/saves");
      const res = await branchesSettingAction(projectId);
      return res.success ? Boolean(res.data?.enabled) : false;
    },
    staleTime: 60_000,
  });
  if (!on.data || task.taskNumber == null) return null;
  const name = branchNameForTask(task.taskNumber, task.title);
  const open = (branch: string) => {
    const url = new URL(window.location.href);
    for (const k of ["task", "taskId", "filesView", "mr", "save", "bpath", "bfile"]) url.searchParams.delete(k);
    url.searchParams.set("tab", "files");
    url.searchParams.set("branch", branch);
    window.location.assign(url.toString());
  };
  async function start() {
    setBusy(true);
    try {
      const res = await createBranchAction(projectId, name, "main", task.id);
      if (res.success) { toast.success(`Created ${res.data.branch.name} for #${task.taskNumber}`); open(res.data.branch.name); return; }
      if (res.code === "BRANCH_EXISTS") { open(name); return; }
      toast.error(res.error);
    } finally { setBusy(false); }
  }
  return (
    <button type="button" onClick={() => void start()} disabled={busy} title={`Start work on ${name}`}
      className="nb-touch-target inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
      <GitBranch className="size-3.5" aria-hidden="true" />{busy ? "Starting…" : "Start work"}
    </button>
  );
}
