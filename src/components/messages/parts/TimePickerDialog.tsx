"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/** A datetime-local value for an <input>, in the viewer's own zone. */
export function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Clock reads for open and submit (never while rendering a pure value).
const clock = () => Date.now();

/**
 * One "pick a time" dialog: Schedule message, Reschedule and a custom Saved reminder.
 * Open it by setting `initial` (a Date); `null` closes it.
 */
export function TimePickerDialog({ initial, title, label, confirmLabel, onPick, onClose }: {
  initial: Date | null;
  title: string;
  label: string;
  confirmLabel: string;
  onPick: (at: Date) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={initial !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{title}</DialogTitle>
        {/* Keyed on the opening time so each open starts from its own default. */}
        {initial ? <PickerForm key={initial.getTime()} initial={initial} label={label} confirmLabel={confirmLabel} onPick={onPick} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PickerForm({ initial, label, confirmLabel, onPick, onClose }: {
  initial: Date;
  label: string;
  confirmLabel: string;
  onPick: (at: Date) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(() => localInput(initial));
  const [min] = useState(() => localInput(new Date(clock() + 60_000)));
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) onPick(new Date(value));
        onClose();
      }}
    >
      <label className="block text-[13px] font-medium">{label}
        <input type="datetime-local" required min={min} value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 h-10 w-full rounded-[5px] border border-input bg-background px-3 text-[14px]" />
      </label>
      <DialogFooter>
        <button type="button" onClick={onClose} className="h-9 rounded-[5px] border border-border px-3 text-[13px]">Cancel</button>
        <button type="submit" className="h-9 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground">{confirmLabel}</button>
      </DialogFooter>
    </form>
  );
}
