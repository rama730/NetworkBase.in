"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileDiff } from "lucide-react";

/** "2 change sets ready" in the workspace header (report G12): for people who can change files, when something waits. */
export function ChangeSetsReadyLink({ projectId, slug }: { projectId: string; slug: string }) {
  const ready = useQuery({
    queryKey: ["change-sets", projectId, "open"],
    queryFn: async () => {
      // Loaded when asked, so the header (and its tests) don't pull in the server action module.
      const { listChangeSetsAction } = await import("@/app/actions/files/change-sets");
      const res = await listChangeSetsAction(projectId, "open,ready");
      return res.success ? res.data : { enabled: false, changeSets: [], nextCursor: null };
    },
    staleTime: 30_000,
  });
  const count = (ready.data?.changeSets ?? []).filter((s) => s.status === "ready").length;
  if (!count) return null;
  return (
    <Link
      href={`/workspaces/${encodeURIComponent(slug)}?tab=files&filesView=changes`}
      className="nb-ui-label inline-flex items-center gap-1.5 rounded-[5px] border border-[#D14E24]/40 px-2 py-0.5 text-[#B03F1C] hover:bg-[#FCF0EA] dark:text-[#F08A63] dark:hover:bg-[#D14E24]/10"
    >
      <FileDiff className="size-3.5" aria-hidden />
      {count} change set{count === 1 ? "" : "s"} ready
    </Link>
  );
}
