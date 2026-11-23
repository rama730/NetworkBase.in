"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PixelIcon } from "@/components/auth/pixel";
import { Button } from "@/components/ui/button";
import { TabMarker } from "@/components/ui/TabMarker";
import { padCount } from "@/lib/ui/tab-marker";
import { deletionDays } from "@/lib/settings/checkup";
import { cn } from "@/lib/utils";

/** Square mono tag (mix): VERIFIED, OFF, THIS DEVICE. `ok` green, `warn` amber, `hot` clay, `bad` red. */
export function Tag({ tone, tick, children }: { tone?: "ok" | "warn" | "hot" | "bad"; tick?: boolean; children: ReactNode }) {
  return <span className={cn("nbs-tag", tone)}>{tick ? <PixelIcon name="check" /> : null}{children}</span>;
}

export type SegOption<T extends string> = { value: T; label: string };

/**
 * One choice out of a few as segmented cells (mix): the clay marker slides to the chosen one. Arrow keys move focus
 * (roving), Space or Enter picks: passing over a choice never changes a setting, since these save at once.
 */
export function SegChoice<T extends string>({ label, value, options, onChange, busy, id, size = "sm", testIdPrefix }: {
  label: string;
  value: T | null | undefined;
  options: ReadonlyArray<SegOption<T>>;
  onChange: (value: T) => void;
  busy?: boolean;
  id?: string;
  size?: "sm" | "md";
  /** Puts `data-testid="<prefix>-<value>"` on each choice. */
  testIdPrefix?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const stop = Math.max(0, options.findIndex((option) => option.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    refs.current[(index + step + options.length) % options.length]?.focus();
  };
  return (
    <div id={id} role="radiogroup" aria-label={label} aria-busy={busy || undefined} className="nb-seg" data-size={size === "sm" ? "sm" : undefined}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[index] = node; }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-disabled={busy || undefined}
          data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
          tabIndex={index === stop ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, index)}
          onClick={() => { if (!busy && option.value !== value) onChange(option.value); }}
        >
          {option.label}
        </button>
      ))}
      <TabMarker />
    </div>
  );
}

/**
 * Any one-of-a-few choice drawn as cells or cards (theme cards, accent swatches, spacing cells): a radiogroup with
 * roving focus. Arrows move, Space or Enter picks (these save at once). `marker` adds the sliding clay line.
 */
export function ChoiceCells<T extends string>({ label, value, options, onChange, className, render, marker, id, testIdPrefix }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className: string;
  render: (option: { value: T; label: string }, selected: boolean) => ReactNode;
  marker?: boolean;
  id?: string;
  /** Puts `data-testid="<prefix>-<value>"` on each choice. */
  testIdPrefix?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const stop = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div id={id} role="radiogroup" aria-label={label} className={className}>
      {options.map((option, index) => (
        <button key={option.value} ref={(node) => { refs.current[index] = node; }} type="button" role="radio" aria-checked={option.value === value} aria-label={option.label} tabIndex={index === stop ? 0 : -1}
          className={className === "nbs-themes" ? "nbs-theme" : className === "nbs-swatches" ? "nbs-swatch" : undefined}
          data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            refs.current[(index + step + options.length) % options.length]?.focus();
          }}
          onClick={() => { if (option.value !== value) onChange(option.value); }}>
          {render(option, option.value === value)}
        </button>
      ))}
      {marker ? <TabMarker /> : null}
    </div>
  );
}

export type LogEntry = { key: string; date: string; dateTime?: string; event: ReactNode; detail?: ReactNode; risky?: boolean; actions?: ReactNode };

/** The one log layout (mix): a mono date column, the event, the detail in mono, actions on the right. First four, then "Show all NN". */
export function LogList({ entries, first = 4, empty, label, older }: { entries: LogEntry[]; first?: number; empty?: ReactNode; label: string; older?: ReactNode }) {
  const [all, setAll] = useState(false);
  if (!entries.length) return <>{empty ?? null}</>;
  const shown = all ? entries : entries.slice(0, first);
  return (
    <div className="nbs-log">
      <div role="list" aria-label={label} className="grid">
        {shown.map((entry) => (
          <div key={entry.key} role="listitem" className={cn("nbs-lg", entry.risky && "risky")}>
            <time dateTime={entry.dateTime}>{entry.date}</time>
            <div className="ev"><span>{entry.event}</span>{entry.detail ? <small>{entry.detail}</small> : null}</div>
            <div className="acts">{entry.actions}</div>
          </div>
        ))}
      </div>
      {entries.length > first || older ? (
        <div className="nbs-more">
          {entries.length > first ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll((value) => !value)}>
              {all ? "Show fewer" : <>Show all <span aria-hidden="true">{padCount(entries.length)}</span><span className="sr-only">{entries.length}</span></>}
            </Button>
          ) : null}
          {/* Older entries still on the server: offered once everything loaded here is showing. */}
          {older && (all || entries.length <= first) ? older : null}
        </div>
      ) : null}
    </div>
  );
}

/** The 30 squares beside Cancel deletion: filled for each day left. */
export function DeletionSquares({ hardDeleteAt }: { hardDeleteAt: string }) {
  const { left, total } = deletionDays(hardDeleteAt);
  return <span className="nbs-days" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i >= left ? "gone" : undefined} />)}</span>;
}
