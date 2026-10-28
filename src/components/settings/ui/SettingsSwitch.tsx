"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * The settings switch (spec: 38×22, clay when on). It applies at once, so `pending` marks the one row that is
 * saving: it keeps its place in the tab order (never disabled while focused) but ignores further taps.
 * `showLabel` adds the visible On/Off text; screen readers get the state from the switch itself.
 */
export function SettingsSwitch({
  className,
  showLabel,
  checked,
  disabled,
  pending,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  showLabel?: boolean;
  pending?: boolean;
}) {
  const switchElement = (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-border bg-muted transition-colors outline-none before:absolute before:-inset-x-1 before:-inset-y-[11px] before:content-[''] focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[pending=true]:cursor-progress data-[pending=true]:opacity-70",
        className,
      )}
      checked={checked}
      disabled={disabled}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      onCheckedChange={(next) => {
        if (!pending) onCheckedChange?.(next);
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[16px] translate-x-[2px] rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );

  if (!showLabel) {
    return switchElement;
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      <span aria-hidden="true" className={cn("nb-meta text-muted-foreground select-none w-6 text-right", disabled && "opacity-50")}>
        {checked ? "On" : "Off"}
      </span>
      {switchElement}
    </div>
  );
}
