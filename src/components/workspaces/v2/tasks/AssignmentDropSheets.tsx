"use client";

// Assignment flow (2026-11-10): what a drop on the board opens. Members: Hand in (Completed) and What's in the way
// (Blocked). Admins: Publish (a draft on In progress), Close (on Completed) and Reopen (a closed one on In progress).
// Every sheet moves nothing until its button is pressed; Cancel leaves the card where it was.

import { useEffect, useState, useTransition } from "react";

import {
  approveAllSubmittedAction, closeAssignmentAction, publishAssignmentAction, remindCopiesAction, reopenAssignmentAction, updateAssignmentAction,
} from "@/app/actions/assignments";
import { DateTimeField, afterPresets } from "@/components/organizations/DateTimeField";
import { HandInSection } from "@/components/organizations/HandInSection";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { audienceLabel } from "@/components/workspaces/tabs/sprint/AssignmentStages";
import { toast } from "@/lib/feedback";
import { todayInZone } from "@/lib/organizations/zoned-time";
import type { TaskSurfaceRecord } from "@/lib/workspaces/task-presentation";

export type DropSheet =
  | { kind: "hand_in"; task: TaskSurfaceRecord }
  | { kind: "block"; task: TaskSurfaceRecord; columnId: string }
  | { kind: "publish" | "close" | "reopen"; task: TaskSurfaceRecord };

type Props = { sheet: DropSheet | null; onClose: () => void; onChanged: () => void; onOpenTask: (task: TaskSurfaceRecord) => void;
  /** Moves a copy to Blocked with its note (the board's own move, so the card moves like any drag). */
  onBlock: (task: TaskSurfaceRecord, columnId: string, note: string) => Promise<void> };

export function AssignmentDropSheets({ sheet, onClose, onChanged, onOpenTask, onBlock }: Props) {
  const open = Boolean(sheet);
  const change = (next: boolean) => { if (!next) onClose(); };
  if (!sheet) return null;
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {sheet.kind === "hand_in" ? <HandInSheet task={sheet.task} onClose={onClose} onChanged={onChanged} onOpenTask={onOpenTask} />
          : sheet.kind === "block" ? <BlockSheet task={sheet.task} onCancel={onClose} onConfirm={async (note) => { await onBlock(sheet.task, sheet.columnId, note); onClose(); }} />
            : sheet.kind === "publish" ? <PublishSheet task={sheet.task} onClose={onClose} onChanged={onChanged} />
              : sheet.kind === "close" ? <CloseSheet task={sheet.task} onClose={onClose} onChanged={onChanged} />
                : <ReopenSheet task={sheet.task} onClose={onClose} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

/** Decision 2: dropped on Completed. The copy's own Hand in, with its files, link or answer as they are. */
function HandInSheet({ task, onClose, onChanged, onOpenTask }: { task: TaskSurfaceRecord; onClose: () => void; onChanged: () => void; onOpenTask: (task: TaskSurfaceRecord) => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Hand in {task.title}?</DialogTitle>
        <DialogDescription>It moves to Completed once you press Hand in. Nothing is handed in by itself.</DialogDescription>
      </DialogHeader>
      <HandInSection copyId={task.id}
        onOpenFiles={() => { onClose(); onOpenTask(task); }}
        onSubmitted={(review) => { toast.success(review ? "Handed in. It waits for review." : "Done."); onClose(); onChanged(); }} />
      <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></DialogFooter>
    </>
  );
}

/** Decision 6: dropped on Blocked. The note is optional; with one, the admins see it as a message on the copy. */
function BlockSheet({ task, onCancel, onConfirm }: { task: TaskSurfaceRecord; onCancel: () => void; onConfirm: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <DialogHeader>
        <DialogTitle>What’s in the way?</DialogTitle>
        <DialogDescription>{task.title} moves to Blocked. {task.fromLabel ? `Your note goes to ${task.fromLabel} as a message.` : "Your note goes to the admins as a message."}</DialogDescription>
      </DialogHeader>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Note (optional)</span>
        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="nb-textarea" placeholder="The starter file won’t compile" />
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={pending} onClick={() => start(() => onConfirm(note.trim()))}>{pending ? "Moving…" : "Move to Blocked"}</Button>
      </DialogFooter>
    </>
  );
}

/** Decision 4: a draft dropped on In progress. Publishing makes the copies now. */
function PublishSheet({ task, onClose, onChanged }: { task: TaskSurfaceRecord; onClose: () => void; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [noReviewer, setNoReviewer] = useState(false);
  const publish = (options: { dropMissing?: boolean; reviewOff?: boolean } = {}) => start(async () => {
    const r = await publishAssignmentAction(task.id, options);
    if (r.success) { toast.success(`Published. ${r.copies} ${r.copies === 1 ? "copy" : "copies"} made.`); onClose(); onChanged(); return; }
    setError(r.error);
    setLeft("left" in r && Boolean(r.left));
    setNoReviewer("noReviewer" in r && r.noReviewer === true);
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>Publish {task.title}?</DialogTitle>
        <DialogDescription>It goes to {audienceLabel(task.audience ?? null)}. Everyone gets their copy now and is told.</DialogDescription>
      </DialogHeader>
      {error ? <p role="alert" className="rounded-md bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        {noReviewer ? <Button type="button" disabled={pending} onClick={() => publish({ reviewOff: true })}>Turn review off and publish</Button>
          : left ? <Button type="button" disabled={pending} onClick={() => publish({ dropMissing: true })}>Publish to the rest</Button>
            : <Button type="button" disabled={pending} onClick={() => publish()}>{pending ? "Publishing…" : "Publish"}</Button>}
      </DialogFooter>
    </>
  );
}

/** Decision 4: an open assignment dropped on Completed. Who hasn't handed in, and what to do with the waiting work. */
function CloseSheet({ task, onClose, onChanged }: { task: TaskSurfaceRecord; onClose: () => void; onChanged: () => void }) {
  const stages = task.assignmentStages ?? null;
  const c = stages?.counts;
  const notIn = c ? c.not_started + c.in_progress + c.returned + c.missing : 0;
  const waiting = c?.submitted ?? 0;
  const [approve, setApprove] = useState(waiting > 0);
  const [remind, setRemind] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirm = () => start(async () => {
    setError(null);
    // Order matters: a reminder and the approvals go out while it's still open, then it closes.
    if (remind && notIn) { const r = await remindCopiesAction(task.id); if (!r.success) return setError(r.error); }
    if (approve && waiting) {
      const r = await approveAllSubmittedAction(task.id);
      if (!r.success) return setError(r.error);
      if (r.failed.length) return setError(`${r.failed.length} couldn’t be approved: ${r.failed[0]!.reason} Nothing was closed.`);
    }
    const r = await closeAssignmentAction(task.id);
    if (!r.success) return setError(r.error);
    toast.success(`Closed ${task.title}.`);
    onClose(); onChanged();
  });
  const people = stages?.teams ? "groups" : "people";
  return (
    <>
      <DialogHeader>
        <DialogTitle>Close {task.title}?</DialogTitle>
        <DialogDescription>No more hand-ins after this. You can reopen it by dragging it back to In progress.</DialogDescription>
      </DialogHeader>
      {notIn ? <p className="rounded-md bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-destructive">{notIn} {notIn === 1 ? (stages?.teams ? "group hasn’t" : "person hasn’t") : `${people} haven’t`} handed in. They’ll show as Missing and can’t hand in after this.</p> : null}
      <div className="space-y-2 text-sm">
        {waiting ? <label className="flex items-start gap-2"><input type="checkbox" className="nb-check mt-0.5" checked={approve} onChange={(e) => setApprove(e.target.checked)} /><span>Approve the {waiting} waiting for review</span></label> : null}
        {notIn ? <label className="flex items-start gap-2"><input type="checkbox" className="nb-check mt-0.5" checked={remind} onChange={(e) => setRemind(e.target.checked)} /><span>Message the {notIn} who haven’t handed in</span></label> : null}
      </div>
      {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={pending} onClick={confirm}>{pending ? "Closing…" : "Close"}</Button>
      </DialogFooter>
    </>
  );
}

/** Decision 4: a closed assignment dropped on In progress. A new due date when the old one has passed. */
function ReopenSheet({ task, onClose, onChanged }: { task: TaskSurfaceRecord; onClose: () => void; onChanged: () => void }) {
  const passed = Boolean(task.dueDate && new Date(task.dueDate).getTime() < Date.now());
  const [due, setDue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [due]);
  const confirm = () => start(async () => {
    if (passed && !due) return setError("Pick a new due date. The old one has passed.");
    const r = await reopenAssignmentAction(task.id);
    if (!r.success) return setError(r.error);
    if (passed && due) {
      const u = await updateAssignmentAction(task.id, { dueDate: new Date(due).toISOString() });
      if (!u.success) { toast.error(`Reopened, but the due date didn’t change: ${u.error}`); onClose(); onChanged(); return; }
    }
    toast.success(`Reopened ${task.title}.`);
    onClose(); onChanged();
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>Reopen {task.title}?</DialogTitle>
        <DialogDescription>People who haven’t handed in can hand in again. They’re told.</DialogDescription>
      </DialogHeader>
      {passed ? (
        <div className="space-y-1 text-sm"><span className="block font-medium">New due date</span>
          <DateTimeField value={due} onChange={setDue} timeZone={null} summary="Due" aria-label="New due date" presets={afterPresets(todayInZone(null))} presetsLabel="From today" />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={pending} onClick={confirm}>{pending ? "Reopening…" : "Reopen"}</Button>
      </DialogFooter>
    </>
  );
}
