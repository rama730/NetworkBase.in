"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, X } from "@/components/ui/icons";
import { useState } from "react";

import { readAssetsAction, saveAssetLibraryAction } from "@/app/actions/assets";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { copyOrSay } from "@/lib/clipboard";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { ASSET_TYPE_LABEL, ASSET_TYPES, type BrandColor, type OutsideLink } from "@/lib/workflows/assets";

const assetsKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "assets"];
const small = cn(FORM_SECONDARY_CLASS, "h-7 px-2 text-[12px]");

function useSave(projectId: string) {
  const queryClient = useQueryClient();
  return async (patch: { colors?: BrandColor[]; outsideLinks?: OutsideLink[] }, done: string) => {
    const r = await saveAssetLibraryAction({ projectId, ...patch });
    if (!r.success) { toast.error(r.error); return false; }
    await queryClient.invalidateQueries({ queryKey: assetsKey(projectId) });
    toast(done);
    return true;
  };
}

/** Report 38.16 W7 (A7.3): Colors: swatches with name and hex, Copy; people who can change files add and remove. */
export function ColorsStrip({ projectId, colors, canEdit }: { projectId: string; colors: BrandColor[]; canEdit: boolean }) {
  const save = useSave(projectId);
  const [adding, setAdding] = useState<{ name: string; hex: string } | null>(null);
  if (!colors.length && !canEdit) return null;
  return (
    <section aria-label="Colors" className="space-y-2" data-testid="assets-colors">
      <div className="flex items-center gap-2"><h3 className="text-[12px] font-medium text-muted-foreground">Colors <span className="font-mono">{colors.length}</span></h3>
        {canEdit ? <button type="button" className={small} onClick={() => setAdding({ name: "", hex: "#" })}><Plus aria-hidden="true" className="mr-0.5 inline size-3" />Add color</button> : null}</div>
      {colors.length ? (
        <ul className="flex flex-wrap gap-2">
          {colors.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center gap-2 rounded-[6px] border border-border py-1 pl-1 pr-2">
              <span aria-hidden="true" className="size-7 rounded-[4px] border border-border" style={{ background: c.hex }} />
              <span className="text-[12px]"><span className="block font-medium">{c.name}</span><span className="font-mono text-[11px] text-muted-foreground">{c.hex}</span></span>
              <button type="button" aria-label={`Copy ${c.name} ${c.hex}`} className="text-[11px] underline" onClick={() => copyOrSay(c.hex, () => toast(`Copied ${c.hex}`))}>Copy</button>
              {canEdit ? <button type="button" aria-label={`Remove ${c.name}`} className="text-muted-foreground" onClick={() => void save({ colors: colors.filter((_, j) => j !== i) }, `Removed ${c.name}`)}><X aria-hidden="true" className="size-3.5" /></button> : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-[12px] text-muted-foreground">No brand colors yet.</p>}
      {adding ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save({ colors: [...colors, { name: adding.name.trim(), hex: adding.hex.trim() }] }, "Color added").then((ok) => { if (ok) setAdding(null); }); }}>
          <Field label="Name" htmlFor="color-name"><input id="color-name" autoFocus maxLength={40} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Ink" className={cn(inputClassName(false), "h-8 w-32")} /></Field>
          <Field label="Hex" htmlFor="color-hex"><input id="color-hex" maxLength={7} value={adding.hex} onChange={(e) => setAdding({ ...adding, hex: e.target.value })} placeholder="#141A1E" className={cn(inputClassName(false), "h-8 w-28 font-mono")} /></Field>
          <input type="color" aria-label="Pick a color" value={/^#[0-9a-f]{6}$/i.test(adding.hex) ? adding.hex : "#000000"} onChange={(e) => setAdding({ ...adding, hex: e.target.value.toUpperCase() })} className="h-8 w-10 rounded border border-border" />
          <button type="submit" className={cn(FORM_PRIMARY_CLASS, "h-8")} disabled={!adding.name.trim()}>Add</button>
          <button type="button" className={cn(FORM_SECONDARY_CLASS, "h-8")} onClick={() => setAdding(null)}>Cancel</button>
        </form>
      ) : null}
    </section>
  );
}

/** W8 (call 5): outside links as cards (opened by people in a new tab, never fetched); Add outside link. */
export function OutsideLinks({ projectId, links, canEdit, type }: { projectId: string; links: OutsideLink[]; canEdit: boolean; type: string }) {
  const save = useSave(projectId);
  const [adding, setAdding] = useState(false);
  const shown = links.filter((l) => !type || l.type === type);
  if (!shown.length && !canEdit) return null;
  return (
    <section aria-label="Outside links" className="space-y-2" data-testid="assets-outside-links">
      <div className="flex items-center gap-2"><h3 className="text-[12px] font-medium text-muted-foreground">Outside links <span className="font-mono">{shown.length}</span></h3>
        {canEdit ? <button type="button" className={small} onClick={() => setAdding(true)}><Plus aria-hidden="true" className="mr-0.5 inline size-3" />Add outside link</button> : null}</div>
      {shown.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((l) => (
            <li key={l.id} className="rounded-[8px] border border-border p-2" data-testid="outside-link">
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-start gap-1.5 text-[12px] font-medium hover:underline"><ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 break-words">{l.name}</span></a>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{new URL(l.url).host}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><span className="rounded-[3px] border border-border px-1">{ASSET_TYPE_LABEL[l.type]}</span>{l.tags.join(" · ")}
                {canEdit ? <button type="button" aria-label={`Remove ${l.name}`} className="ml-auto" onClick={() => void save({ outsideLinks: links.filter((x) => x.id !== l.id) }, "Link removed")}><X aria-hidden="true" className="size-3.5" /></button> : null}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? <OutsideLinkDialog onClose={() => setAdding(false)} onAdd={(link) => save({ outsideLinks: [...links, link] }, "Link added")} /> : null}
    </section>
  );
}

function OutsideLinkDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (link: OutsideLink) => Promise<boolean> }) {
  const [v, setV] = useState({ name: "", url: "", type: "footage", tags: "" });
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!v.name.trim()) return void toast.error("Name the link");
    if (!/^https?:\/\/\S+$/i.test(v.url.trim())) return void toast.error("Links start with https:// or http://");
    setBusy(true);
    const ok = await onAdd({ id: crypto.randomUUID().slice(0, 12), name: v.name.trim(), url: v.url.trim(), type: v.type as OutsideLink["type"],
      tags: v.tags.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean) });
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="outside-link-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Add outside link</DialogTitle><DialogDescription className="text-xs text-muted-foreground">For footage or files kept somewhere else. NetworkBase stores the link and never opens it.</DialogDescription></div>
        <div className="space-y-3.5 px-6 py-4">
          <Field label="Name" htmlFor="link-name" required><input id="link-name" maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Raw footage, day 1" className={inputClassName(false)} /></Field>
          <Field label="Link" htmlFor="link-url" required><input id="link-url" type="url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://" className={inputClassName(false)} /></Field>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Asset type" htmlFor="link-type"><SelectWrap><select id="link-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className={selectClassName()}>{ASSET_TYPES.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}</select></SelectWrap></Field>
            <Field label="Tags" htmlFor="link-tags"><input id="link-tags" value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="day-1, b-roll" className={inputClassName(false)} /></Field>
          </div>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void add()}>{busy ? "Adding…" : "Add link"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** W7 in a document: a Brand guide's Colors block shows the workspace's colors (people who can read Files). */
export function BrandColors({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: assetsKey(projectId), queryFn: () => readAssetsAction(projectId), staleTime: 30_000 });
  if (!query.data) return <div aria-hidden="true" className="nb-skeleton my-4 h-14 rounded-[8px]" />;
  const colors = query.data.success ? query.data.library.colors : [];
  return colors.length ? (
    <ul className="my-4 flex flex-wrap gap-2" aria-label="Brand colors" data-testid="brand-colors">
      {colors.map((c, i) => <li key={`${c.name}-${i}`} className="flex items-center gap-2 rounded-[6px] border border-border py-1 pl-1 pr-2 text-[12px]"><span aria-hidden="true" className="size-7 rounded-[4px] border border-border" style={{ background: c.hex }} /><span><span className="block font-medium">{c.name}</span><span className="font-mono text-[11px] text-muted-foreground">{c.hex}</span></span></li>)}
    </ul>
  ) : <p className="my-4 text-[13px] text-muted-foreground">No brand colors yet. Add them in Files → Assets → Colors.</p>;
}
