"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";

import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import { FOLDER_LIST_GRID_TEMPLATE } from "./folder/layout";

/**
 * The Files tab's shared chrome (design audit, 17 Nov 2026): the pieces All files and Trash already use, so every
 * view has one 48px header (breadcrumb and actions), at most one flush 37px strip under it, then content.
 */

// ── The header's title ───────────────────────────────────────────────────────────────────────────────────────────

/** The header shows this instead of its own breadcrumb while a view provides one. */
export const FilesHeaderTitleContext = createContext<((node: ReactNode) => void) | null>(null);

/** A view's own breadcrumb in the Files header (outside a header, as in tests, it renders in place). */
export function FilesHeaderTitle({ children }: { children: ReactNode }) {
  const set = useContext(FilesHeaderTitleContext);
  useEffect(() => {
    if (!set) return;
    set(children);
  }, [set, children]);
  useEffect(() => () => set?.(null), [set]);
  return set ? null : <div className="flex min-h-12 items-center border-b border-border px-2">{children}</div>;
}

/** The header's title state: the header renders `title ?? its own breadcrumb`. */
export function useFilesHeaderTitle() {
  return useState<ReactNode>(null);
}

export type Crumb = { label: ReactNode; onClick?: () => void; mono?: boolean; title?: string };

/** The breadcrumb, styled like All files' BreadcrumbBar: segments, "/" between, the last one bold. */
export function HeaderCrumbs({ items, after, label = "Breadcrumb" }: { items: Crumb[]; after?: ReactNode; label?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center px-1">
      <nav aria-label={label} className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center">
              {i > 0 ? <span aria-hidden="true" className="mx-0.5 select-none text-muted-foreground/60">/</span> : null}
              {last || !c.onClick ? (
                <span aria-current={last ? "page" : undefined} title={c.title} className={cn("max-w-[260px] truncate px-1.5 py-0.5", last ? "font-semibold text-foreground" : "text-muted-foreground", c.mono && "font-mono")}>{c.label}</span>
              ) : (
                <button type="button" onClick={c.onClick} title={c.title} className={cn("flex max-w-[200px] items-center gap-1 truncate rounded-[4px] px-1.5 py-0.5 text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-[#D14E24]", c.mono && "font-mono")}>{c.label}</button>
              )}
            </span>
          );
        })}
        {after ? <span className="ml-1.5 flex shrink-0 items-center gap-1.5">{after}</span> : null}
      </nav>
    </div>
  );
}

// ── Buttons (the header's own classes) ───────────────────────────────────────────────────────────────────────────

const focus = "outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D14E24]";
/** All files' Upload: the one primary action of a screen. */
export const headerPrimary = `nb-touch-target flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:pointer-events-none disabled:opacity-50 ${focus}`;
/** All files' New folder. */
export const headerButton = `nb-touch-target flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-muted ${focus}`;
/** A small button inside a strip (the strip's controls are 24–28px, like Trash's filters). */
export const stripButton = `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] border border-border bg-card px-2 text-xs font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-muted ${focus}`;
export const stripPrimary = `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] bg-primary px-2 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:pointer-events-none disabled:opacity-50 ${focus}`;

// ── The strip under the header ──────────────────────────────────────────────────────────────────────────────────

/** Trash's toolbar: flush under the header, 37px, the toolbar surface and a hairline. */
export function FilesStrip({ children, label, tone, role = "toolbar", className }: { children: ReactNode; label: string; tone?: "warning"; role?: "toolbar" | "status" | "region"; className?: string }) {
  return (
    <div
      role={role}
      aria-label={label}
      aria-live={role === "status" ? "polite" : undefined}
      className={cn(
        "flex min-h-[37px] shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5",
        tone === "warning"
          ? "border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[var(--status-warning-soft)] text-[var(--status-warning)]"
          : "border-[#DBD5C8] bg-[#FAF8F5] dark:border-border dark:bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Trash's filter chip, with its count. */
export function FilterChip({ on, label, count, onClick, testId }: { on: boolean; label: string; count?: number | null; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 font-mono text-[11px] transition-colors",
        on
          ? "bg-primary font-semibold text-primary-foreground shadow-xs"
          : "border border-[#DBD5C8]/70 bg-white text-[#4C5A61] hover:bg-[#E8E3D9] hover:text-[#141A1E] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-white/10 dark:hover:text-foreground",
      )}
    >
      <span>{label}</span>
      {count != null ? <span className={cn("text-[10px] tabular-nums max-md:text-[11px]", on ? "text-white/80" : "text-[#8E9AA1] dark:text-muted-foreground")}>{count}</span> : null}
    </button>
  );
}

/** Trash's inline filter field. */
export function StripSearch({ id, value, onChange, placeholder, label, onSubmit }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; label: string; onSubmit?: (value: string) => void }) {
  return (
    <form className="relative flex items-center" onSubmit={(e) => { e.preventDefault(); onSubmit?.(value); }}>
      <Search className="pointer-events-none absolute left-2 size-3 text-[#6B7880] dark:text-muted-foreground" aria-hidden="true" />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSubmit?.(value)}
        placeholder={placeholder}
        className="h-6 w-36 rounded-[3px] border border-[#DBD5C8] bg-white pl-6 pr-6 font-mono text-[11px] text-[#141A1E] placeholder:text-[#8E9AA1] focus:border-[#D14E24] focus:outline-none dark:border-border dark:bg-card dark:text-foreground sm:w-48"
      />
      {value ? (
        <button type="button" onClick={() => { onChange(""); onSubmit?.(""); }} aria-label={`Clear: ${label}`} className="absolute right-1.5 flex size-3.5 items-center justify-center rounded-[2px] text-[#6B7880] hover:text-[#141A1E] dark:text-muted-foreground dark:hover:text-foreground">
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </form>
  );
}

/** The strip's muted mono note ("6 items", "Type:"). */
export function StripNote({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-[#4C5A61] dark:text-muted-foreground">{children}</span>;
}

// ── Badges ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";
/** `.nb-status`: mono, uppercase, 3px corners, the app's status colours. */
export function StatusBadge({ tone = "neutral", children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return <span className="nb-status shrink-0" data-tone={tone} title={title}>{children}</span>;
}

/** +12 −3 in the app's success and danger colours. Nothing when the lines weren't counted. */
export function LineCounts({ lines, className }: { lines: { added: number; removed: number } | null | undefined; className?: string }) {
  if (!lines) return null;
  return (
    <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", className)} aria-label={`${lines.added} line${lines.added === 1 ? "" : "s"} added, ${lines.removed} removed`}>
      <span className="text-[var(--status-success)]">+{lines.added}</span> <span className="text-[var(--status-danger)]">−{lines.removed}</span>
    </span>
  );
}

// ── Rows (All files' and Trash's grid) ───────────────────────────────────────────────────────────────────────────

/** One 48px row on the explorer's grid: name, updated, size, by, actions. */
export function GridRow({ children, onClick, label, selected, testId }: { children: ReactNode; onClick?: () => void; label?: string; selected?: boolean; testId?: string }) {
  return (
    <div
      role="row"
      aria-label={label}
      aria-selected={selected || undefined}
      data-testid={testId}
      onClick={onClick}
      style={{ gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE }}
      className={cn("group grid min-h-12 items-center gap-x-3 border-b border-border/60 px-4 text-xs transition-colors hover:bg-[#FAF8F5] dark:hover:bg-white/[0.02]", onClick && "cursor-pointer", selected && "bg-[#FAF8F4] dark:bg-white/[0.04]")}
    >
      {children}
    </div>
  );
}

/** A row's name cell: chip, the name (mono, like the explorer) and an optional second line. */
export function NameCell({ chip, name, sub, after, onOpen, nameLabel }: { chip: ReactNode; name: ReactNode; sub?: ReactNode; after?: ReactNode; onOpen?: () => void; nameLabel?: string }) {
  const body = (
    <>
      {chip}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs font-medium text-[#141A1E] transition-colors group-hover:text-[#D14E24] dark:text-foreground">{name}</span>
          {after}
        </span>
        {sub ? <span className="mt-0.5 block truncate font-mono text-[11px] text-[#6B7880] dark:text-muted-foreground">{sub}</span> : null}
      </span>
    </>
  );
  return (
    <div role="cell" data-column="name" className="flex min-w-0 items-center gap-2.5 py-1.5">
      {onOpen ? <button type="button" aria-label={nameLabel} onClick={(e) => { e.stopPropagation(); onOpen(); }} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#D14E24]">{body}</button> : body}
    </div>
  );
}

export function Cell({ children, column, align }: { children?: ReactNode; column: string; align?: "right" }) {
  return <div role="cell" data-column={column} className={cn("min-w-0 truncate font-mono text-[11px] text-[#6B7880] dark:text-muted-foreground", align === "right" && "text-right")}>{children ?? "—"}</div>;
}

/** A tab row the app's way: 2px underline on the current tab (the spec's tabs). */
export function UnderlineTabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 items-end gap-4 border-b border-border px-4">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cn("-mb-px border-b-2 py-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#D14E24]", value === t.id ? "border-[#D14E24] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A 28px chip for a row's icon, the size and surface of FileTypeChip's folder chip. */
export function IconChip({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[3px] border border-[#DBD5C8] bg-[#F3F0EA] text-[#4C5A61] dark:border-white/15 dark:bg-white/10 dark:text-muted-foreground [&_svg]:size-4">
      {children}
    </span>
  );
}

type PersonLike = { id?: string; name?: string | null; username?: string | null; avatarUrl?: string | null; former?: boolean } | null | undefined;
/** Someone whose account is gone reads "Deleted user", as other authored content does (H24). */
export const personName = (p: PersonLike) => (p === null ? "Deleted user" : p?.name || (p?.username ? `@${p.username}` : "Someone"));

/** A person, the way Trash shows "Deleted by": the shared square avatar (3px corners) and the name. */
export function Person({ person, size = 18, nameClassName }: { person: PersonLike; size?: 18 | 20 | 26; nameClassName?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <UserAvatar
        identity={{ fullName: person?.name ?? null, username: person?.username ?? null, avatarUrl: person?.avatarUrl ?? null }}
        size={size}
        roundedClassName="rounded-[3px]"
        fallbackClassName="text-[9px] font-mono bg-[#E8E3D9] text-[#141A1E] dark:bg-white/10 dark:text-foreground"
      />
      <span className={cn("truncate", nameClassName)}>{personName(person)}</span>
      {person?.former ? <span className="shrink-0 text-[11px] text-muted-foreground">former member</span> : null}
    </span>
  );
}
