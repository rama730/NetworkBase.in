"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function SettingsSwitch({
  className,
  showLabel,
  checked,
  disabled,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  showLabel?: boolean;
}) {
  const switchElement = (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-muted transition-colors outline-none before:absolute before:-inset-3 before:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className,
      )}
      checked={checked}
      disabled={disabled}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );

  if (!showLabel) {
    return switchElement;
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className={cn("nb-meta text-muted-foreground select-none w-6 text-right", disabled && "opacity-50")}>
        {checked ? "On" : "Off"}
      </span>
      {switchElement}
    </div>
  );
}
