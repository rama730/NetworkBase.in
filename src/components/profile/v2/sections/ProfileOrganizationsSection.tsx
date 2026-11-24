"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "@/components/ui/icons";

import type { MyProfileOrganization } from "@/app/actions/organizations";

// Loaded when the dialog is used, so the profile card never pulls server actions into its first render.
const actions = () => import("@/app/actions/organizations");
import { Button } from "@/components/ui/button";
import { SavedTick } from "@/components/ui/SavedTick";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { profileEditHref } from "@/lib/profile/edit-route";
import { toast } from "@/lib/feedback";
import { WorkspaceAvatar } from "@/components/workspaces/WorkspaceAvatar";


/** Manage organizations (report §38.2): a Show switch and the order, each saved at once. */
export function ManageOrganizationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<MyProfileOrganization[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void actions().then((m) => m.readMyProfileOrganizationsAction()).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [open]);
  const saved = () => setSavedAt(Date.now());
  // The Show switch flips at once and, if this fails, flips back with Try again beside it (controls round 2).
  const toggle = async (row: MyProfileOrganization) => {
    const result = await (await actions()).updateMyOrgMembershipAction(row.orgId, { show_on_profile: !row.showOnProfile });
    if (result.success) setRows((current) => current?.map((r) => (r.orgId === row.orgId ? { ...r, showOnProfile: !r.showOnProfile } : r)) ?? null);
    return result;
  };
  const move = (index: number, by: -1 | 1) => startTransition(async () => {
    if (!rows) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    setRows(next);
    const result = await (await actions()).saveMyOrganizationOrderAction(next.map((r) => r.orgId));
    if (!result.success) return void toast.error(result.error);
    saved();
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) router.refresh(); }}>
      <DialogContent size="confirm">
        <DialogHeader>
          <DialogTitle>Manage organizations</DialogTitle>
          <DialogDescription>Turning one off hides it, its contribution and its workspaces from others. Nothing is deleted.</DialogDescription>
        </DialogHeader>
        {rows === null ? <p role="status" className="nb-waiting text-sm text-muted-foreground"><PixelBeat />Loading your organizations…</p> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">You’re not in an organization yet. <Link href="/join" className="text-primary hover:underline">Join with code</Link></p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row, index) => (
              <li key={row.orgId} className="flex items-center gap-2 py-2.5 text-sm">
                <span className="flex flex-col">
                  <button type="button" aria-label={`Move ${row.title} up`} disabled={pending || index === 0} onClick={() => move(index, -1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label={`Move ${row.title} down`} disabled={pending || index === rows.length - 1} onClick={() => move(index, 1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                </span>
                <WorkspaceAvatar project={{ id: row.orgId, title: row.title, coverImage: row.coverImage }} size="row" kind="organization" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{row.title}</span><span className="text-[12px] text-muted-foreground">{row.role}</span></span>
                <label className="flex items-center gap-1.5 text-[13px]">
                  <SettingsSwitch checked={row.showOnProfile} onCheckedChange={() => toggle(row)} aria-label={`Show ${row.title} on my profile`} />
                  Show
                </label>
                <Link href={profileEditHref("experience", "overview", { contribution: row.contributionId ?? undefined })} className="text-[13px] text-primary hover:underline">Edit contribution</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-muted-foreground">Private organizations show only to you and their members.</p>
        <div className="flex items-center justify-end gap-3">{savedAt && !pending ? <SavedTick key={savedAt} /> : null}<Button type="button" onClick={() => onOpenChange(false)}>Done</Button></div>
      </DialogContent>
    </Dialog>
  );
}
