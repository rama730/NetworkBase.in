"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DateTimeField } from "@/components/organizations/DateTimeField";
import { zoneName } from "@/lib/organizations/zoned-time";
import { SCHEDULE_MAX_AHEAD_MS } from "@/lib/messaging/schedule-window";

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
      <DialogContent className="nbm nbm-dialog">
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
  // The server takes at most 120 days ahead; the picker stops there too.
  const [max] = useState(() => localInput(new Date(clock() + SCHEDULE_MAX_AHEAD_MS)));
  // The picker shows your local time; say which zone that is, the way people say it ("India Standard Time").
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value || value < min || value > max) return;
        onPick(new Date(value));
        onClose();
      }}
    >
      {/* The app's one date-and-time field (the same as every organization form), in your own zone. */}
      <div className="block text-[13px] font-medium">{label}
        <DateTimeField value={value} onChange={setValue} timeZone={zone} min={min.slice(0, 10)} summary={label} aria-label={label} aria-describedby="time-picker-zone" className="mt-1" />
      </div>
      <p id="time-picker-zone" className="text-[13px] text-muted-foreground">Your time zone: {zoneName(zone)}</p>
      {value && (value < min || value > max) ? <p role="status" className="text-[13px] text-destructive">Pick a time at least a minute from now and within 120 days.</p> : null}
      <DialogFooter paper>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!value || value < min || value > max}>{confirmLabel}</Button>
      </DialogFooter>
    </form>
  );
}
