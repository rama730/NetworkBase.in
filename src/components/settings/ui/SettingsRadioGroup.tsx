"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsRadioOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: LucideIcon;
};

/**
 * One choice out of a few that applies as soon as it is picked (spec: Radio, selected radio and label).
 *
 * Arrow keys move focus between the options and Space or Enter picks the focused one. Picking is separate from
 * moving on purpose: choices here save at once (and some ask to confirm), so passing over one must never
 * change a setting. While a save is running (`busy`) the options stay focusable and simply ignore picks, so
 * focus never drops to the page. The selected option shows a filled dot and a border (never a box-shadow,
 * which the app's focus rules remove).
 */
export function SettingsRadioGroup<T extends string>({
  label,
  description,
  value,
  onValueChange,
  options,
  busy = false,
  className,
  optionsClassName,
  renderOption,
  testIdPrefix,
}: {
  label: string;
  description?: string;
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: SettingsRadioOption<T>[];
  busy?: boolean;
  className?: string;
  optionsClassName?: string;
  /** Replaces the default card (the accent swatches draw their own). */
  renderOption?: (option: SettingsRadioOption<T>, state: { selected: boolean }) => ReactNode;
  /** Puts `data-testid="<prefix>-<value>"` on each option. */
  testIdPrefix?: string;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // Tab lands on the selected option, or the first when nothing is selected yet.
  const tabStop = Math.max(0, options.findIndex((option) => option.value === value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    refs.current[(index + step + options.length) % options.length]?.focus();
  };

  return (
    <div className={className}>
      <h4 id={labelId} className="nb-ui-label text-foreground">{label}</h4>
      {description ? <p id={descriptionId} className="nb-compact mt-1 text-muted-foreground">{description}</p> : null}
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        className={cn("mt-3 grid gap-2", optionsClassName)}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              ref={(node) => { refs.current[index] = node; }}
              type="button"
              role="radio"
              data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
              aria-checked={selected}
              tabIndex={index === tabStop ? 0 : -1}
              aria-disabled={busy || undefined}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => { if (!busy && !selected) onValueChange(option.value); }}
              className={cn(
                "text-left transition-colors focus-visible:border-foreground",
                renderOption
                  ? undefined
                  : cn(
                      "flex min-h-16 w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-3 hover:bg-muted aria-disabled:cursor-progress aria-disabled:opacity-70",
                      selected && "border-primary bg-primary/5",
                    ),
              )}
            >
              {renderOption ? renderOption(option, { selected }) : (
                <>
                  <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border border-input", selected && "border-primary")}>
                    {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
                  </span>
                  {Icon ? <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", selected && "bg-primary/10 text-primary")}><Icon className="size-4" strokeWidth={1.75} aria-hidden="true" /></span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block nb-ui-label text-foreground">{option.label}</span>
                    {option.description ? <span className="block nb-compact mt-1 text-muted-foreground">{option.description}</span> : null}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
