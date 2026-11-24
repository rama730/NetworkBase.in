"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Globe } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";

import { readDocsSettingsAction, setDocsSettingsAction, setDocsSiteAction } from "@/app/actions/workspace/doc";
import { WORKSPACE_DOC_LIST_QUERY_KEY } from "@/hooks/workspaces/useWorkspaceDocData";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { WorkspaceDocHeading } from "@/lib/workspaces/doc-headings";
import type { WorkspaceDocListItem } from "@/lib/workspaces/doc";
import { docsSiteMenu } from "@/lib/workspaces/doc-sections";

const docsSettingsKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "docs-settings"];
export const useDocsSettings = (projectId: string) =>
  useQuery({ queryKey: docsSettingsKey(projectId), queryFn: () => readDocsSettingsAction(projectId), staleTime: 60_000 });
const name = (d: WorkspaceDocListItem) => d.title ?? d.filename.replace(/\.md$/i, "");

/** Report 38.15 W3 (A6.34): the Docs site's menu: sections and their documents, a title filter, and (for editors) the documents not on the site. */
export function DocsSiteMenu({ projectId, docs, activeSlug, canEdit, onOpen }: { projectId: string; docs: WorkspaceDocListItem[]; activeSlug: string; canEdit: boolean; onOpen: (slug: string) => void }) {
  const [filter, setFilter] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const menu = docsSiteMenu(docs);
  // W3: ⌘K / Ctrl+K jumps to Search docs. ponytail: filters titles; text search across docs when Snippets join ⌘K (A6.35).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && search.current?.offsetParent) { e.preventDefault(); search.current.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // W3's menu path for ordering: Move up / Move down renumbers the section's docs.
  async function move(group: WorkspaceDocListItem[], i: number, by: -1 | 1) {
    const next = [...group];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    const results = await Promise.all(next.map((d, order) => setDocsSiteAction(projectId, { docSlug: d.slug, on: true, order })));
    const failed = results.find((r) => !r.success);
    if (failed && !failed.success) toast.error(failed.error);
    await queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) });
  }
  const match = (d: WorkspaceDocListItem) => !filter.trim() || name(d).toLowerCase().includes(filter.trim().toLowerCase());
  const item = (d: WorkspaceDocListItem, i?: number, group?: WorkspaceDocListItem[]) => (
    <li key={d.id} className="flex items-center gap-0.5">
      <button type="button" onClick={() => onOpen(d.slug)} aria-current={d.slug === activeSlug ? "page" : undefined}
        className={cn("min-w-0 flex-1 truncate rounded-[5px] px-2 py-1 text-left text-[13px]", d.slug === activeSlug ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>
        {name(d)}
      </button>
      {canEdit && group && i !== undefined && d.slug === activeSlug && !filter ? (
        <>
          <button type="button" aria-label={`Move ${name(d)} up`} disabled={i === 0} onClick={() => void move(group, i, -1)} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp aria-hidden="true" className="size-3" /></button>
          <button type="button" aria-label={`Move ${name(d)} down`} disabled={i === group.length - 1} onClick={() => void move(group, i, 1)} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown aria-hidden="true" className="size-3" /></button>
        </>
      ) : null}
    </li>
  );
  return (
    <nav aria-label="Docs" className="space-y-3 text-[13px]" data-testid="docs-site-menu">
      <input ref={search} type="search" aria-label="Search docs" aria-keyshortcuts="Meta+K Control+K" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search docs" className="h-8 w-full rounded-[5px] border border-border bg-transparent px-2 text-[13px] outline-none placeholder:text-muted-foreground" />
      {filter && !menu.groups.some((g) => g.docs.some(match)) ? <p className="px-2 text-[12px] text-muted-foreground">No results for “{filter}”</p> : null}
      {menu.groups.length === 0 ? <p className="text-[12px] text-muted-foreground">Nothing on the docs site yet.</p> : null}
      {menu.groups.map((g) => {
        const shown = g.docs.filter(match);
        return shown.length ? <div key={g.id}><p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{g.label}</p><ul>{shown.map((d) => item(d, g.docs.indexOf(d), g.docs))}</ul></div> : null;
      })}
      {canEdit && menu.off.length ? (
        <details><summary className="cursor-pointer px-2 text-[11px] text-muted-foreground">Not on the site ({menu.off.length})</summary><ul className="mt-1">{menu.off.filter(match).map((d) => item(d))}</ul></details>
      ) : null}
    </nav>
  );
}

/** W3: On this page: the document's headings; the current one is marked in words for screen readers too. */
export function OnThisPage({ headings }: { headings: WorkspaceDocHeading[] }) {
  const shown = headings.filter((h) => h.level >= 2 && h.level <= 3);
  if (!shown.length) return null;
  return (
    <nav aria-label="On this page" className="space-y-1 text-[12px]" data-testid="docs-on-this-page">
      <p className="font-medium text-muted-foreground">On this page</p>
      <ul>{shown.map((h) => <li key={h.id} className={h.level === 3 ? "pl-3" : ""}><a href={`#${h.id}`} onClick={(e) => { const el = document.getElementById(h.id); if (!el) return; e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="block truncate py-0.5 text-muted-foreground hover:text-foreground">{h.text}</a></li>)}</ul>
    </nav>
  );
}

/** W3: Previous / Next along the menu's order. */
export function DocsPrevNext({ docs, activeSlug, onOpen }: { docs: WorkspaceDocListItem[]; activeSlug: string; onOpen: (slug: string) => void }) {
  const order = docsSiteMenu(docs).order;
  const i = order.findIndex((d) => d.slug === activeSlug);
  if (i < 0) return null;
  const prev = order[i - 1], next = order[i + 1];
  return (
    <div className="mt-10 flex justify-between gap-3 border-t border-border pt-4 text-[13px]" data-testid="docs-prev-next">
      {prev ? <button type="button" onClick={() => onOpen(prev.slug)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground"><ChevronLeft aria-hidden="true" className="size-4" /><span><span className="block text-[11px]">Previous</span>{name(prev)}</span></button> : <span />}
      {next ? <button type="button" onClick={() => onOpen(next.slug)} className="flex items-center gap-1 text-right text-muted-foreground hover:text-foreground"><span><span className="block text-[11px]">Next</span>{name(next)}</span><ChevronRight aria-hidden="true" className="size-4" /></button> : null}
    </div>
  );
}

/** W3: Show on docs site, per document, for its editors (off by default). */
export function DocsSiteToggle({ projectId, docSlug, on }: { projectId: string; docSlug: string; on: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    try {
      const r = await setDocsSiteAction(projectId, { docSlug, on: !on });
      if (!r.success) throw new Error(r.error);
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) });
      toast(on ? "Taken off the docs site" : "On the docs site");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t change the docs site");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" aria-pressed={on} disabled={busy} onClick={() => void flip()} data-testid="docs-site-toggle"
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] border px-2.5 text-[12px] font-medium", on ? "border-foreground bg-muted/60" : "border-border text-muted-foreground hover:text-foreground")}>
      <Globe aria-hidden="true" className="size-3.5" />{on ? "On docs site" : "Show on docs site"}
    </button>
  );
}

/** W3/W5: Pages · Docs site · Snippets above Documents, when more than one view is switched on. */
export type DocsView = "pages" | "site" | "snippets";
export function DocsViewSwitch({ views, view, onChange }: { views: DocsView[]; view: DocsView; onChange: (v: DocsView) => void }) {
  if (views.length < 2) return null;
  return (
    <div role="group" aria-label="Documents view" className="mb-3 inline-flex rounded-[6px] border border-border p-0.5 text-[12px]" data-testid="docs-view-switch">
      {views.map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => onChange(v)} className={cn("rounded-[4px] px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>
          {v === "pages" ? "Pages" : v === "site" ? "Docs site" : "Snippets"}
        </button>
      ))}
    </div>
  );
}

/** W3/W5 (A6.34): Settings → Workflows → Documents: Docs site and Snippets, both off by default; owners and admins switch them. */
export function DocsSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const settings = useDocsSettings(workspaceId).data;
  const [busy, setBusy] = useState(false);
  if (!settings) return <div aria-hidden="true" className="nb-skeleton h-20 rounded-[8px]" />;
  if (!settings.success) return null;
  async function flip(patch: { siteEnabled?: boolean; snippetsEnabled?: boolean }) {
    setBusy(true);
    const before = settings;
    queryClient.setQueryData(docsSettingsKey(workspaceId), { ...before, ...patch });
    try {
      const r = await setDocsSettingsAction(workspaceId, patch);
      if (!r.success) throw new Error(r.error);
    } catch (e) {
      queryClient.setQueryData(docsSettingsKey(workspaceId), before);
      toast.error(e instanceof Error ? e.message : "Couldn’t save the document settings.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-[8px] border border-border p-4" data-testid="docs-settings">
      <h3 className="nb-ui-label text-foreground">Documents</h3>
      <label className="flex min-h-8 items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-1" checked={settings.siteEnabled} disabled={!settings.canManage || busy} onChange={(e) => void flip({ siteEnabled: e.target.checked })} />
        <span><span className="font-medium">Docs site</span><span className="block text-[12px] text-muted-foreground">Documents gains a Docs site view: menu, page and On this page. When Documents is public, visitors see only the documents switched on for it.</span></span>
      </label>
      <label className="flex min-h-8 items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-1" checked={settings.snippetsEnabled} disabled={!settings.canManage || busy} onChange={(e) => void flip({ snippetsEnabled: e.target.checked })} />
        <span><span className="font-medium">Snippets</span><span className="block text-[12px] text-muted-foreground">Documents gains a Snippets view: code your team reuses, with its language and Copy.</span></span>
      </label>
    </div>
  );
}
