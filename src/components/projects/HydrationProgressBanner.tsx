"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import { getProjectHydrationProgressAction } from "@/app/actions/project";

export interface HydrationProgressBannerProps {
  projectId: string;
}

type HydrationProgress = { status: string; completed: number; total: number };
const REALTIME_MISSED_PROGRESS_MS = 30_000;
const FALLBACK_POLL_MS = 15_000;

export function HydrationProgressBanner({ projectId }: HydrationProgressBannerProps) {
  const [hydration, setHydration] = useState<HydrationProgress | null>(null);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let fallbackPolling = false;
    const supabase = createClient();

    const clearPoll = () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };

    const queuePoll = (delay: number) => {
      clearPoll();
      if (!active) return;
      timeout = setTimeout(() => void fetchProgress(), delay);
    };

    // Polls only while an import is running; a project that was never imported costs one read.
    const fetchProgress = async () => {
      if (!active) return;
      const meta = await getProjectHydrationProgressAction(projectId).catch(() => undefined);
      if (!active) return;
      if (meta === undefined) {
        fallbackPolling = true;
        queuePoll(FALLBACK_POLL_MS);
        return;
      }
      setHydration(meta);
      if (meta?.status === "in_progress") queuePoll(fallbackPolling ? FALLBACK_POLL_MS : REALTIME_MISSED_PROGRESS_MS);
      else clearPoll();
    };

    void fetchProgress();

    const channel = subscribeActiveResource({
      supabase,
      resourceType: "project_hydration",
      resourceId: projectId,
      subscriberId: "hydration-banner",
      bindings: [
        {
          event: "UPDATE",
          table: "projects",
          filter: `id=eq.${projectId}`,
          // The row event carries no import_source (column revoked); it only signals a re-read.
          handler: () => {
            fallbackPolling = false;
            void fetchProgress();
          },
        },
      ],
      onStatus: (status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          fallbackPolling = true;
        }
      },
    });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
      clearPoll();
    };
  }, [projectId]);

  if (!hydration || hydration.status !== "in_progress") {
    return null;
  }

  const percent = hydration.total > 0 ? Math.floor((hydration.completed / hydration.total) * 100) : 0;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl animate-in slide-in-from-top-4 fade-in duration-[260ms]">
      <div className="bg-background/95 backdrop-blur-none border shadow-lg rounded-lg p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🚀</span>
            <span className="font-medium text-sm">Securing files in background…</span>
          </div>
          <span className={cn("inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1", "border-transparent bg-secondary text-secondary-foreground", "font-mono")}>
            {hydration.completed.toLocaleString()} / {hydration.total.toLocaleString()}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Files secured"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 w-full bg-secondary rounded-full overflow-hidden"
        >
          <div className="h-full bg-primary transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[260ms] ease-out" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          You can freely view and edit files while this finishes.
        </p>
      </div>
    </div>
  );
}
