import React from "react";
import { ChevronDown } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

// The New dialog's form parts (Task and Assignment tabs look the same: assignment form redesign, 2026-11-09).

export function SectionDivider({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-1.5">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  required = false,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const describedBy = error
    ? `${htmlFor}-error`
    : hint
      ? `${htmlFor}-hint`
      : undefined;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium text-foreground"
      >
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            "aria-invalid": Boolean(error),
            "aria-describedby": describedBy,
          })
        : children}
      {hint ? <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-mono text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

export function inputClassName(hasError: boolean) {
  return cn(
    "h-[34px] w-full rounded-[5px] border bg-card px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60",
    "border-border focus:border-primary focus:ring-1 focus:ring-primary/20",
    hasError && "border-destructive focus:border-destructive focus:ring-destructive/20",
  );
}

/** The New dialog itself: Task tab, Assignment tab and Use again share it. */
export const FORM_DIALOG_CLASS = "flex max-h-[88vh] w-full flex-col gap-0 overflow-hidden rounded-[12px] border border-[#DBD5C8] bg-card p-0 shadow-2xl sm:max-w-[640px] dark:border-white/10";
export const FORM_FOOTER_CLASS = "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#DBD5C8] bg-[#F3F0EA] px-6 py-3.5 dark:border-white/10 dark:bg-white/5";
export const FORM_SECONDARY_CLASS = "nb-touch-target h-[34px] rounded-[5px] border border-border bg-card px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50";
export const FORM_PRIMARY_CLASS = "nb-touch-target h-[34px] rounded-[5px] bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-2xs transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";

/** A select drawn like the inputs, with an optional icon on the left and a chevron on the right. */
export function selectClassName(hasError = false, withIcon = false) {
  // bg-none drops .nb-select's drawn chevron; SelectWrap draws the Task form's.
  return cn(inputClassName(hasError), "appearance-none cursor-pointer bg-none pr-9", withIcon && "pl-9");
}
export function SelectWrap({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      {icon ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&>svg]:size-4">{icon}</span> : null}
      {children}
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

/** The small "QUICK DATES: 1 WEEK · 2 WEEKS" row under a date. */
export function QuickChips({ label, items }: { label: string; items: Array<{ label: string; active?: boolean; onClick: () => void; disabled?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground max-md:text-[11px]">{label}:</span>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          aria-pressed={item.active ?? false}
          onClick={item.onClick}
          className={cn(
            "inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-[3px] border px-1.5 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors disabled:opacity-50 max-md:text-[11px]",
            item.active
              ? "border-primary bg-primary/10 font-semibold text-primary"
              : "border-border bg-card font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
