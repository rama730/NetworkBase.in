"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { UploadCollisionSummary } from "@/app/actions/files/mutations";

type Choice = "skip" | "keep_both" | "cancel";

/** A bounded upload decision, using the same accessible dialog as file actions. */
export function useUploadCollisionDecision() {
  const [pending, setPending] = useState<{ summary: UploadCollisionSummary; copies: boolean } | null>(null);
  const resolveRef = useRef<((choice: Choice) => void) | null>(null);
  const finish = useCallback((choice: Choice) => {
    resolveRef.current?.(choice);
    resolveRef.current = null;
    setPending(null);
  }, []);
  useEffect(() => () => { resolveRef.current?.("cancel"); }, []);
  const chooseUploadCollision = useCallback((summary: UploadCollisionSummary, copies = false): Promise<Choice> => {
    if (!summary.existingFiles.length && !summary.existingFolders.length) return Promise.resolve("skip");
    resolveRef.current?.("cancel");
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setPending({ summary, copies });
    });
  }, []);
  const uploadCollisionDialog = (
    <Dialog open={!!pending} onOpenChange={open => { if (!open) finish("cancel"); }}>
      <DialogContent className="rounded-[12px] border border-[#DBD5C8] dark:border-white/10">
        <DialogHeader>
          <DialogTitle>Some files have the same name</DialogTitle>
          <DialogDescription className="text-xs text-zinc-600 dark:text-zinc-400">
            {pending?.copies
              ? "Keep existing items and upload renamed copies, or skip matching names. Nothing will be overwritten."
              : "Existing folders will be reused and matching files skipped. Nothing will be overwritten."}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto font-mono text-xs text-zinc-700 dark:text-zinc-300 divide-y divide-[#E8E3D9] dark:divide-white/5 border border-[#DBD5C8] dark:border-white/10 rounded-[5px] px-3">
          {[...(pending?.summary.existingFiles ?? []), ...(pending?.summary.existingFolders ?? [])].slice(0, 20).map(name => <li key={name} className="truncate py-1.5" title={name}>{name}</li>)}
        </ul>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">To revise an existing file, use its “Upload version” action instead.</p>
        <DialogFooter className="bg-[#F3F0EA] dark:bg-white/5 border-t border-[#DBD5C8] dark:border-white/10 -mx-6 -mb-6 px-6 py-3 rounded-b-[12px] flex-wrap gap-2">
          <Button variant="outline" className="nb-touch-target h-[34px] rounded-[5px] text-xs font-medium" onClick={() => finish("cancel")}>Cancel</Button>
          <Button variant="outline" className="nb-touch-target h-[34px] rounded-[5px] text-xs font-medium" onClick={() => finish("skip")}>{pending?.copies ? "Skip existing" : "Continue"}</Button>
          {pending?.copies && <Button className="nb-touch-target h-[34px] rounded-[5px] text-xs font-medium bg-[#D14E24] hover:bg-[#B23F1C] text-white" onClick={() => finish("keep_both")}>Keep both</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { chooseUploadCollision, uploadCollisionDialog };
}
