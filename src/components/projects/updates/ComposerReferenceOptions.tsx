"use client";

import { useEffect, useRef } from "react";
import { ListTodo, Paperclip, Timer, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComposerReferenceOption = {
  id: string;
  kind: string;
  label: string;
  description?: string | null;
};

/** Shared inline reference search used by Updates and profile contribution summaries. */
export function ComposerReferenceOptions<T extends ComposerReferenceOption>({
  query,
  onQueryChange,
  placeholder,
  options,
  loading,
  error,
  onRetry,
  onSelect,
  onClose,
  selectedId,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  options: T[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect: (option: T) => void;
  onClose?: () => void;
  selectedId?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && onClose) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        ref={input}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-foreground/30"
      />
      <div
        className="mt-3 grid max-h-64 gap-2 overflow-y-auto"
        aria-busy={loading}
      >
        {loading ? (
          <div
            role="status"
            aria-label="Loading references"
            className="h-10 rounded-[5px] bg-muted/40"
          />
        ) : error ? (
          <div
            role="alert"
            className="nb-compact rounded-[5px] bg-muted/30 px-3 py-2.5"
          >
            <p>{error}</p>
            {onRetry && (
              <button
                type="button"
                className="mt-1 text-primary"
                onClick={onRetry}
              >
                Retry search
              </button>
            )}
          </div>
        ) : !options.length ? (
          <p className="rounded-[5px] bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            No matching project context.
          </p>
        ) : (
          options.map((option) => {
            const Icon =
              option.kind === "person"
                ? UserRound
                : option.kind === "task"
                  ? ListTodo
                  : option.kind === "sprint"
                    ? Timer
                    : Paperclip;
            const status = option.description?.toLowerCase();
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option)}
                aria-pressed={selectedId === option.id}
                className={cn(
                "nb-touch-target group flex min-w-0 items-center justify-between gap-3 rounded-[5px] border px-3 py-2 text-left transition",
                  selectedId === option.id
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border bg-card hover:border-foreground/20 hover:bg-muted/30",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {option.label}
                  </span>
                </div>
                {option.description &&
                  (option.kind === "task" ? (
                    <span
                      className={cn(
                        "inline-flex h-5 shrink-0 items-center rounded-[3px] border px-[6px] font-mono text-[10px] leading-none font-medium uppercase tracking-[0.09em] max-md:text-[11px]",
                        status === "in_progress" || status === "in progress"
                          ? "border-amber-500/20 bg-amber-500/10 text-amber-600"
                          : status === "done" || status === "completed"
                            ? "border-primary/20 bg-primary/10 text-primary"
                            : "border-border bg-muted/60 text-muted-foreground",
                      )}
                    >
                      {option.description.replace(/_/g, " ")}
                    </span>
                  ) : (
                    <span className="max-w-[140px] shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  ))}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
