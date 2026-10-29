"use client";

import React, { createContext, useContext, useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type Transfer = {
  id: string;
  label: string;
  total: number;
  completed: number;
  failed: number;
  status: "running" | "done" | "error";
  error?: string;
  retry?: () => void;
  abort?: () => void;
};
const TransfersContext = createContext<{
  active: number;
  open: () => void;
  start: (label: string, total: number) => string;
  update: (id: string, patch: Partial<Omit<Transfer, "id">>) => void;
} | null>(null);
export const useFileTransfers = () => useContext(TransfersContext);

/** An on-demand view of the existing upload pipeline, not a second job queue. */
export function FileTransfersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState<Transfer[]>([]);
  const [open, setOpen] = useState(false);
  const start = useCallback((label: string, total: number) => {
    const id = crypto.randomUUID();
    setJobs((current) => [
      { id, label, total, completed: 0, failed: 0, status: "running" },
      ...current.filter((job) => job.status === "running"),
      ...current.filter((job) => job.status !== "running").slice(0, 19),
    ]);
    return id;
  }, []);
  const update = useCallback(
    (id: string, patch: Partial<Omit<Transfer, "id">>) => {
      setJobs((current) =>
        current.map((job) => (job.id === id ? { ...job, ...patch } : job)),
      );
    },
    [],
  );
  const active = jobs.filter((job) => job.status === "running").length;
  React.useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  const handleOpen = React.useCallback(() => setOpen(true), []);
  const contextValue = React.useMemo(
    () => ({ active, start, update, open: handleOpen }),
    [active, start, update, handleOpen],
  );
  return (
    <TransfersContext.Provider value={contextValue}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogTitle>Uploads and downloads</DialogTitle>
          <DialogDescription>
            Uploads in this Files session. Keep this page open while uploads are
            running. Failed items can be retried without re-uploading successful
            items.
          </DialogDescription>
          <div aria-live="polite" className="sr-only">
            {active > 0
              ? `${active} transfer${active === 1 ? "" : "s"} in progress.`
              : jobs.length > 0 && jobs.every((j) => j.status === "done")
                ? "All uploads and downloads finished."
                : ""}
          </div>
          {!jobs.length && (
            <p className="py-6 text-sm text-muted-foreground">
              No uploads or downloads yet.
            </p>
          )}
          <ul className="divide-y divide-border">
            {jobs.map((job) => (
              <li key={job.id} className="space-y-2 py-3 text-sm">
                <p className="break-words font-medium">{job.label}</p>
                <progress
                  className="h-2 w-full rounded-[2px]"
                  value={job.completed}
                  max={Math.max(1, job.total)}
                  aria-label={`Upload progress: ${job.label}`}
                />
                <p className="text-muted-foreground">
                  {job.status === "running"
                    ? "Uploading"
                    : job.status === "error"
                      ? "Needs attention"
                      : "Complete"}{" "}
                  · {job.completed} of {job.total}
                  {job.failed ? ` · ${job.failed} failed` : ""}
                </p>
                {job.error && (
                  <p className="break-words text-red-600 dark:text-red-400">
                    {job.error}
                  </p>
                )}
                {job.status === "running" && job.abort && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="min-h-11 rounded border border-destructive/30 px-3 text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        job.abort?.();
                        update(job.id, { status: "error", error: "Transfer canceled" });
                      }}
                    >
                      Cancel transfer
                    </button>
                  </div>
                )}
                {job.status !== "running" && (
                  <div className="flex gap-2">
                    {job.retry && (
                      <button
                        type="button"
                        className="min-h-11 rounded border px-3"
                        onClick={() => {
                          const retryFn = job.retry;
                          setJobs((current) =>
                            current.filter((item) => item.id !== job.id),
                          );
                          retryFn?.();
                        }}
                      >
                        Retry failed items
                      </button>
                    )}
                    <button
                      type="button"
                      className="min-h-11 rounded px-3 text-muted-foreground"
                      onClick={() =>
                        setJobs((current) =>
                          current.filter((item) => item.id !== job.id),
                        )
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </TransfersContext.Provider>
  );
}
