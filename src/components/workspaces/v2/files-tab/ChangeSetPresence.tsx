"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileDiff } from "lucide-react";

type Open = { id: string; title: string; status: string; agent: string | null; files: number };

/** One open draft in words: "Claude Code is changing 23 files for this task" (report G15). */
export function presenceLine(s: Open, where: "task" | "file") {
  const who = s.agent ? `${s.agent} is` : "A draft is";
  const what = `changing ${s.files} file${s.files === 1 ? "" : "s"}`;
  return where === "task" ? `${who} ${what} for this task` : `${who} ${what} here, including this one`;
}

/**
 * Open change sets on a task or a file (G15), linking to their review. Nothing for people who can't change the files,
 * or when nothing is open.
 */
export function ChangeSetPresence({ projectId, slug, taskId, path }: { projectId: string; slug?: string | null; taskId?: string; path?: string }) {
  const where = taskId ? "task" : "file";
  const open = useQuery({
    queryKey: ["change-sets", projectId, "presence", taskId ?? path],
    queryFn: async (): Promise<Open[]> => {
      // Loaded when asked, so the task and file views (and their tests) don't pull in the server action module.
      const { openChangeSetsForAction } = await import("@/app/actions/files/change-sets");
      const res = await openChangeSetsForAction(projectId, taskId ? { taskId } : { path });
      return res.success ? (res.data as Open[]) : [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  if (!open.data?.length) return null;
  return (
    <ul aria-label="Open change sets" className="space-y-1">
      {open.data.slice(0, 3).map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 rounded-[5px] border border-border bg-muted/20 px-3 py-1.5 text-[12px] text-foreground">
          <FileDiff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{presenceLine(s, where)}</span>
          <Link href={`/workspaces/${encodeURIComponent(slug || projectId)}?tab=files&filesView=changes&changes=${s.id}`} className="shrink-0 underline underline-offset-2 hover:text-foreground">
            {s.status === "ready" ? "Review" : "See draft"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
