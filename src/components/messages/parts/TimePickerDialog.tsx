"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
      <DialogContent>
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
  // The picker shows your local time; say which zone that is.
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " "));
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
        <Input type="datetime-local" required min={min} value={value} onChange={(e) => setValue(e.target.value)} className="mt-1" aria-describedby="time-picker-zone" />
      </label>
      <p id="time-picker-zone" className="text-[13px] text-muted-foreground">Your time zone: {zone}</p>
      <DialogFooter paper>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit">{confirmLabel}</Button>
      </DialogFooter>
    </form>
  );
}
