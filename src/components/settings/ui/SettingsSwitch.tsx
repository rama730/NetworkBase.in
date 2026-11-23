"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { saveOutcome } from "@/lib/ui/optimistic";

/**
 * The settings switch (spec: 38×22, clay when on). It applies at once, so `pending` marks the one row that is
 * saving: it keeps its place in the tab order (never disabled while focused) but ignores further taps.
 * `showLabel` adds the visible On/Off text; screen readers get the state from the switch itself.
 *
 * Controls round 2: it flips the moment you press. When `onCheckedChange` returns a promise (a save), a failure (a
 * throw, or `{ success: false }`) flips it back and says so beside it, with Try again. No toast.
 */
export function SettingsSwitch({
  className,
  showLabel,
  checked,
  disabled,
  pending,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "onCheckedChange"> & {
  showLabel?: boolean;
  pending?: boolean;
  onCheckedChange?: (checked: boolean) => unknown;
}) {
  const [shown, setShown] = useState(checked);
  const [failed, setFailed] = useState<string | null>(null);
  const attempt = useRef<boolean | null>(null);
  // The saved value arrived (a refetch, or a step-up that retried): show it and drop any old failure.
  useEffect(() => { setShown(checked); setFailed(null); }, [checked]);
  const flip = (next: boolean) => {
    attempt.current = next;
    setFailed(null);
    const result = onCheckedChange?.(next);
    // Flip first only when we can watch the save; otherwise the caller's `checked` stays the truth.
    if (result instanceof Promise) {
      if (checked !== undefined) setShown(next);
      void saveOutcome(result).then((error) => {
        if (!error || attempt.current !== next) return;
        if (checked !== undefined) setShown(!next);
        setFailed(error);
      });
    }
  };
  const switchElement = (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-[4px] border border-border bg-muted transition-colors outline-none before:absolute before:-inset-x-1 before:-inset-y-[11px] before:content-[''] focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[pending=true]:cursor-progress data-[pending=true]:opacity-70",
        className,
      )}
      checked={checked === undefined ? undefined : shown}
      disabled={disabled}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      onCheckedChange={(next) => {
        if (!pending) flip(next);
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[14px] translate-x-[3px] rounded-[2px] bg-muted-foreground transition-[transform,background-color] duration-[160ms] ease-[cubic-bezier(.16,1,.3,1)] data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );

  const retry = failed ? (
    <span role="alert" className="nb-retry">
      <b>Not saved</b><span className="sr-only">: {failed}</span>
      <button type="button" title={failed} onClick={() => flip(!shown)}>Try again</button>
    </span>
  ) : null;

  if (!showLabel) {
    return retry ? <span className="inline-flex shrink-0 items-center gap-3">{retry}{switchElement}</span> : switchElement;
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      {retry}
      <span aria-hidden="true" className={cn("nb-meta text-muted-foreground select-none w-6 text-right", disabled && "opacity-50")}>
        {(checked === undefined ? checked : shown) ? "On" : "Off"}
      </span>
      {switchElement}
    </div>
  );
}
