"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createSnippetAction, readSnippetCodeAction, readSnippetsAction } from "@/app/actions/workspace/doc";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOpenDocAfter } from "@/components/workspaces/doc/DocMeeting";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { WORKSPACE_DOC_LIST_QUERY_KEY } from "@/hooks/workspaces/useWorkspaceDocData";
import { copyOrSay } from "@/lib/clipboard";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { matchesSnippet, SNIPPET_LANGUAGES, snippetMarkdown } from "@/lib/workflows/snippets";

const snippetsKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "snippets"];

/** Report 21.4, 38.15 W5 (A6.35): the Snippets view: search, Language, a list with Copy; New snippet for editors. */
export function SnippetsView({ projectId, canEdit, onOpen }: { projectId: string; canEdit: boolean; onOpen: (slug: string) => void }) {
  const query = useQuery({ queryKey: snippetsKey(projectId), queryFn: () => readSnippetsAction(projectId), staleTime: 30_000 });
  const [q, setQ] = useState("");
  const [language, setLanguage] = useState("");
  const [adding, setAdding] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  // W5: ⌘K / Ctrl+K jumps to Search snippets, as it does to Search docs on the Docs site.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && search.current?.offsetParent) { e.preventDefault(); search.current.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (query.isLoading) return <div aria-hidden="true" className="nb-skeleton h-40 rounded-[8px]" />;
  if (!query.data?.success) return <div className="nb-empty-state py-12" role="alert"><p className="nb-card-title">Couldn’t load the snippets</p><button type="button" className="mt-3 text-sm font-medium text-primary underline" onClick={() => void query.refetch()}>Try again</button></div>;
  const all = query.data.snippets;
  const shown = all.filter((s) => (!language || s.language === language) && (!q.trim() || matchesSnippet(s, q)));
  const languages = [...new Set(all.map((s) => s.language))].sort();
  async function copy(slug: string, name: string) {
    const r = await readSnippetCodeAction(projectId, slug);
    if (!r.success) return void toast.error(r.error);
    copyOrSay(r.code, () => toast(`Copied ${name}`));
  }
  return (
    <section aria-label="Snippets" data-testid="snippets-view" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={search} type="search" aria-label="Search snippets" aria-keyshortcuts="Meta+K Control+K" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search snippets" className={cn(inputClassName(false), "h-8 max-w-[260px] text-[13px]")} />
        <SelectWrap><select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} className={cn(selectClassName(), "h-8 text-[13px]")}>
          <option value="">Any language</option>{languages.map((l) => <option key={l}>{l}</option>)}
        </select></SelectWrap>
        {canEdit ? <button type="button" className={cn(FORM_PRIMARY_CLASS, "ml-auto h-8")} onClick={() => setAdding(true)}>New snippet</button> : null}
      </div>
      {all.length === 0 ? (
        <div className="nb-empty-state py-12" role="status"><p className="nb-card-title">No snippets yet</p><p className="text-sm text-muted-foreground">Save code your team reuses, with its language and what it’s for.</p></div>
      ) : shown.length === 0 ? <p className="text-[13px] text-muted-foreground">No snippets match.</p> : (
        <ul className="divide-y divide-border rounded-[8px] border border-border">
          {shown.map((s) => (
            <li key={s.slug} className="flex items-center gap-3 px-3 py-2">
              <Code2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => onOpen(s.slug)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-medium">{s.name}</span>
                {s.purpose ? <span className="block truncate text-[12px] text-muted-foreground">{s.purpose}</span> : null}
              </button>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{s.language}</span>
              {s.tags.length ? <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{s.tags.join(" · ")}</span> : null}
              <button type="button" aria-label={`Copy ${s.name}`} onClick={() => void copy(s.slug, s.name)} className="inline-flex h-8 items-center gap-1 rounded-[5px] border border-border px-2 text-[12px] font-medium hover:bg-muted"><Copy aria-hidden="true" className="size-3.5" />Copy</button>
            </li>
          ))}
        </ul>
      )}
      <NewSnippetDialog projectId={projectId} open={adding} onOpenChange={setAdding} />
    </section>
  );
}

/** W5: New snippet: name, language, code, what it's for, tags, source link → a small document filed as a snippet. */
export function NewSnippetDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const openDoc = useOpenDocAfter(projectId);
  const [v, setV] = useState({ name: "", language: "TypeScript", code: "", purpose: "", tags: "", source: "" });
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  async function create() {
    if (!v.name.trim()) return void toast.error("Name the snippet");
    if (!v.code.trim()) return void toast.error("Paste the code");
    const source = v.source.trim();
    if (source && !/^https?:\/\/\S+$/i.test(source)) return void toast.error("The source link starts with http:// or https://");
    setBusy(true);
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      const name = v.name.trim().replace(/[\\/:*?"<>|#]/g, "").slice(0, 80);
      const made = await createDocFile(projectId, `${name}.md`, snippetMarkdown({ name, language: v.language, code: v.code, purpose: v.purpose.trim() || undefined, sourceUrl: source || undefined }));
      const r = await createSnippetAction(projectId, { docSlug: made.slug, language: v.language, tags: v.tags.split(","), ...(v.purpose.trim() ? { purpose: v.purpose.trim() } : {}) });
      if (!r.success) {
        const { unlinkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
        await unlinkWorkspaceDocAction(projectId, made.slug).catch(() => undefined);
        throw new Error(r.error);
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: snippetsKey(projectId) }), queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) })]);
      toast(`Snippet saved · ${name}`);
      onOpenChange(false);
      setV({ name: "", language: v.language, code: "", purpose: "", tags: "", source: "" });
      openDoc(made.slug);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save the snippet");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onOpenChange(false); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="new-snippet-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">New snippet</DialogTitle><DialogDescription className="text-xs text-muted-foreground">A small document with the code; edit it later in Files.</DialogDescription></div>
        <div className="max-h-[65vh] space-y-3.5 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-[1fr_160px] gap-3.5">
            <Field label="Name" htmlFor="snippet-name" required><input id="snippet-name" maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Retry with backoff" className={inputClassName(false)} /></Field>
            <Field label="Language" htmlFor="snippet-language"><SelectWrap><select id="snippet-language" value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })} className={selectClassName()}>
              {SNIPPET_LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </select></SelectWrap></Field>
          </div>
          <Field label="Code" htmlFor="snippet-code" required><textarea id="snippet-code" rows={8} spellCheck={false} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} className={cn(inputClassName(false), "h-auto py-2 font-mono text-[12px]")} /></Field>
          <Field label="What it’s for" htmlFor="snippet-purpose"><input id="snippet-purpose" maxLength={300} value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })} className={inputClassName(false)} /></Field>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Tags" htmlFor="snippet-tags"><input id="snippet-tags" value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="network, util" className={inputClassName(false)} /></Field>
            <Field label="Source link" htmlFor="snippet-source"><input id="snippet-source" type="url" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} placeholder="https://" className={inputClassName(false)} /></Field>
          </div>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void create()}>{busy ? "Saving…" : "Save snippet"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
