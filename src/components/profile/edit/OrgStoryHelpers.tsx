"use client";

import { useState, useTransition } from "react";

import { readOrgStoryStarterAction, setWorkRecordAction } from "@/app/actions/org-profile";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/feedback";

/**
 * An org entry's story helpers (report §24.5): Start from About (owners and admins), Start from my work, and the
 * opt-in Work record. The inserted text is the member's to edit; About stays org content.
 */
export function OrgStoryHelpers({ contributionId, canStartFromAbout, showWorkRecord, onInsert }: {
  contributionId: string;
  canStartFromAbout: boolean;
  showWorkRecord: boolean;
  onInsert: (text: string) => void;
}) {
  const [workRecord, setWorkRecord] = useState(showWorkRecord);
  const [pending, startTransition] = useTransition();
  const start = (kind: "about" | "work") => startTransition(async () => {
    const result = await readOrgStoryStarterAction(contributionId, kind);
    if (!result.success) return void toast.error(result.error);
    if (!result.text) return void toast.message(kind === "about" ? "The organization has no description yet" : "Nothing completed yet");
    onInsert(result.text);
  });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {canStartFromAbout ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start("about")}>Start from About</Button> : null}
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start("work")}>Start from my work</Button>
      <label className="ml-auto flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={workRecord} disabled={pending} onChange={(e) => {
          const next = e.target.checked;
          setWorkRecord(next);
          startTransition(async () => {
            const result = await setWorkRecordAction(contributionId, next);
            if (!result.success) { setWorkRecord(!next); toast.error(result.error); }
          });
        }} />
        Show my Work record (counts only)
      </label>
    </div>
  );
}
