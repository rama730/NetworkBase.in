"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, FileType2, Film, Image as ImageIcon, Images, Shapes } from "@/components/ui/icons";
import { useState } from "react";

import { readAssetsAction, readAssetUsedInAction, setAssetDetailsAction, type AssetRow } from "@/app/actions/assets";
import { EmptyState } from "@/components/ui/EmptyState";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { AssetViewer } from "./AssetViewer";
import { ColorsStrip, OutsideLinks } from "./AssetsLibrary";
import { Field, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { ASSET_TYPE_LABEL, ASSET_TYPES, groupByStatus, PRODUCTION_LABEL, PRODUCTION_STATUSES, type AssetDetails } from "@/lib/workflows/assets";

const assetsKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "assets"];
const TYPE_ICON: Record<string, typeof ImageIcon> = { video: Film, footage: Film, audio: AudioLines, font: FileType2, other: Shapes, template: Shapes };
const chip = "rounded-[3px] border border-border px-1.5 py-px text-[11px]";

/** Report 38.16 W1, W2, W6, W9 (plan A7.1): Files → Assets, a gallery with details, Used in and status grouping. */
export function AssetsCollection({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: assetsKey(projectId), queryFn: () => readAssetsAction(projectId), staleTime: 30_000 });
  const [type, setType] = useState<string>("");
  const [group, setGroup] = useState<"type" | "status">("type");
  const [openId, setOpenId] = useState<string | null>(null);
  if (query.isLoading) return <div aria-hidden="true" className="m-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="nb-skeleton aspect-square rounded-[8px]" />)}</div>;
  if (!query.data?.success) return <div className="nb-empty-state m-4 py-12" role="alert"><p className="nb-card-title">Couldn’t load the assets</p><button type="button" className="mt-3 text-sm font-medium text-primary underline" onClick={() => void query.refetch()}>Try again</button></div>;
  const { assets, canEdit, library } = query.data;
  if (!assets.length && !library.colors.length && !library.outsideLinks.length && !canEdit) return <div className="p-4"><EmptyState icon={Images} title="No assets yet" description="Upload images, video or audio, or mark files as assets." /></div>;
  const types = ASSET_TYPES.filter((t) => assets.some((a) => a.type === t));
  const shown = assets.filter((a) => !type || a.type === type);
  const groups = group === "status" ? groupByStatus(shown) : types.filter((t) => !type || t === type).map((t) => ({ id: t, label: ASSET_TYPE_LABEL[t], items: shown.filter((a) => a.type === t) }));
  const open = assets.find((a) => a.id === openId) ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:flex-row" data-testid="assets-view">
      <section aria-label="Assets" className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Assets <span className="font-mono text-[12px] font-normal text-muted-foreground">{assets.length}</span></h2>
          <div role="group" aria-label="Asset type" className="flex flex-wrap gap-1">
            {["", ...types].map((t) => (
              <button key={t || "all"} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={cn(chip, "h-7 px-2 text-[12px]", type === t ? "border-foreground bg-muted font-semibold" : "text-muted-foreground")}>
                {t ? ASSET_TYPE_LABEL[t as keyof typeof ASSET_TYPE_LABEL] : "All"}
              </button>
            ))}
          </div>
          <SelectWrap><select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value as "type" | "status")} className={cn(selectClassName(), "ml-auto h-8 text-[12px]")}>
            <option value="type">By type</option><option value="status">By production status</option>
          </select></SelectWrap>
        </div>
        {!type ? <ColorsStrip projectId={projectId} colors={library.colors} canEdit={canEdit} /> : null}
        {!assets.length ? <EmptyState icon={Images} title="No assets yet" description="Upload images, video or audio, or mark files as assets." compact /> : null}
        {groups.map((g) => (
          <div key={g.id}>
            <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">{g.label} <span className="font-mono">{g.items.length}</span></h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="assets-grid">
              {g.items.map((a) => <li key={a.id}><AssetCard projectId={projectId} asset={a} active={a.id === openId} onOpen={() => setOpenId(a.id === openId ? null : a.id)} /></li>)}
            </ul>
          </div>
        ))}
        <OutsideLinks projectId={projectId} links={library.outsideLinks} canEdit={canEdit} type={type} />
      </section>
      {open ? <AssetDetailsPanel key={open.id} projectId={projectId} asset={open} canEdit={canEdit} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function AssetCard({ projectId, asset, active, onOpen }: { projectId: string; asset: AssetRow; active: boolean; onOpen: () => void }) {
  const Icon = TYPE_ICON[asset.type] ?? ImageIcon;
  const isImage = (asset.mimeType ?? "").startsWith("image/");
  return (
    <button type="button" onClick={onOpen} aria-pressed={active} className={cn("w-full overflow-hidden rounded-[8px] border text-left", active ? "border-foreground" : "border-border hover:border-muted-foreground")} data-testid="asset-card">
      <div className="flex aspect-[4/3] items-center justify-center bg-muted/40">
        {isImage ? <img src={`/api/v1/workspaces/${projectId}/files/${asset.id}/preview?v=${asset.version}`} alt="" loading="lazy" className="h-full w-full object-contain" /> : <Icon aria-hidden="true" className="size-8 text-muted-foreground" />}
      </div>
      <div className="space-y-1 p-2">
        <p className="truncate text-[12px] font-medium">{asset.name}</p>
        <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
          <span className={chip}>{ASSET_TYPE_LABEL[asset.type as keyof typeof ASSET_TYPE_LABEL] ?? "Other"}</span>
          {asset.details?.productionStatus ? <span className={chip}>{PRODUCTION_LABEL[asset.details.productionStatus]}</span> : null}
          <span className="ml-auto font-mono text-[11px]">v{asset.version}</span>
        </p>
      </div>
    </button>
  );
}

function AssetDetailsPanel({ projectId, asset, canEdit, onClose }: { projectId: string; asset: AssetRow; canEdit: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const usedIn = useQuery({ queryKey: [...assetsKey(projectId), "used-in", asset.id], queryFn: () => readAssetUsedInAction(projectId, asset.id), staleTime: 30_000 });
  const d = asset.details ?? {};
  const [v, setV] = useState({ type: d.type ?? asset.type, tags: (d.tags ?? []).join(", "), usageRights: d.usageRights ?? "", credit: d.credit ?? "", productionStatus: d.productionStatus ?? "", notes: d.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const details: AssetDetails = { type: v.type as AssetDetails["type"], tags: v.tags.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean),
        usageRights: v.usageRights, credit: v.credit, productionStatus: (v.productionStatus || null) as AssetDetails["productionStatus"], notes: v.notes };
      const r = await setAssetDetailsAction({ projectId, nodeId: asset.id, details });
      if (!r.success) throw new Error(r.error);
      await queryClient.invalidateQueries({ queryKey: assetsKey(projectId) });
      toast("Details saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save the details");
    } finally {
      setBusy(false);
    }
  }
  const field = (key: "usageRights" | "credit", label: string) => (
    <Field label={label} htmlFor={`asset-${key}`}><input id={`asset-${key}`} disabled={!canEdit} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} className={inputClassName(false)} /></Field>
  );
  return (
    <aside aria-label={`Details: ${asset.name}`} className="w-full shrink-0 space-y-3 rounded-[8px] border border-border p-3 md:w-[300px]" data-testid="asset-details">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-[13px] font-semibold">{asset.name}</p>
        <button type="button" onClick={onClose} className="text-[12px] text-muted-foreground underline">Close</button>
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">v{asset.version} · {asset.path}</p>
      {/* A7.2: open it large, with pinned and timed comments. */}
      <button type="button" className={cn(FORM_SECONDARY_CLASS, "w-full")} onClick={() => setViewing(true)}>Open with comments</button>
      {viewing ? <AssetViewer projectId={projectId} asset={asset} onClose={() => setViewing(false)} /> : null}
      <Field label="Asset type" htmlFor="asset-type"><SelectWrap><select id="asset-type" disabled={!canEdit} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className={selectClassName()}>
        {ASSET_TYPES.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
      </select></SelectWrap></Field>
      <Field label="Tags" htmlFor="asset-tags"><input id="asset-tags" disabled={!canEdit} value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="brand, dark" className={inputClassName(false)} /></Field>
      {field("usageRights", "Usage rights")}
      {field("credit", "Credit")}
      <Field label="Production status" htmlFor="asset-status"><SelectWrap><select id="asset-status" disabled={!canEdit} value={v.productionStatus} onChange={(e) => setV({ ...v, productionStatus: e.target.value })} className={selectClassName()}>
        <option value="">No status</option>{PRODUCTION_STATUSES.map((s) => <option key={s} value={s}>{PRODUCTION_LABEL[s]}</option>)}
      </select></SelectWrap></Field>
      <Field label="Notes" htmlFor="asset-notes"><textarea id="asset-notes" disabled={!canEdit} rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} className={cn(inputClassName(false), "h-auto py-2")} /></Field>
      {canEdit ? <button type="button" className={cn(FORM_PRIMARY_CLASS, "w-full")} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save details"}</button> : null}
      <div data-testid="asset-used-in">
        <p className="text-[12px] font-medium">Used in</p>
        {usedIn.isLoading ? <p role="status" className="nb-waiting text-[12px] text-muted-foreground"><PixelBeat />Looking…</p>
          : usedIn.data?.success && usedIn.data.usedIn.length ? <ul className="mt-1 space-y-0.5 text-[12px]">{usedIn.data.usedIn.map((u) => <li key={`${u.kind}:${u.id}`} className="truncate">{u.kind === "doc" ? "Document · " : ""}{u.label}</li>)}</ul>
          : <p className="text-[12px] text-muted-foreground">Not used in a task or document yet.</p>}
      </div>
    </aside>
  );
}
