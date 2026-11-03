"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";

import { readMyProfileOrganizationsAction, saveMyOrganizationOrderAction, updateMyOrgMembershipAction, type MyProfileOrganization } from "@/app/actions/organizations";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RailSection } from "@/components/ui/rail-section";
import { profileEditHref } from "@/lib/profile/edit-route";
import { toast } from "@/lib/feedback";
import { currentOrganizations, sinceMonth } from "@/lib/organizations/profile-rules";
import { WorkspaceAvatar } from "@/components/workspaces/WorkspaceAvatar";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";

const initials = (title: string) => title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "O";

/**
 * Organizations on the profile (report §4.5, decision 13): right column, between Collaboration preferences and
 * Links. Current members only, in the person's own order. Others see nothing when it's empty.
 */
export function ProfileOrganizationsSection({ contributions, isOwner }: { contributions: ProfileCollaborationContribution[]; isOwner: boolean }) {
  const [managing, setManaging] = useState(false);
  const rows = currentOrganizations(contributions, isOwner);
  if (!isOwner && rows.length === 0) return null;
  return (
    <RailSection
      title="Organizations"
      contentClassName="px-5 max-md:px-4"
      action={isOwner ? (
        <button type="button" aria-label="Manage organizations" onClick={() => setManaging(true)} className="nb-touch-target rounded-[3px] p-1.5 text-muted-foreground hover:bg-muted">
          <Pencil className="size-4" />
        </button>
      ) : null}
    >
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((c) => {
            const body = (
              <>
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted text-[11px] font-semibold">{initials(c.projectTitle)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{c.projectTitle}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {[c.title, c.startDate ? `Since ${sinceMonth(c.startDate)}` : null, isOwner && c.showOnProfile === false ? "Hidden" : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </>
            );
            return (
              <li key={c.id}>
                {c.projectHref ? <Link href={c.projectHref} className="flex items-center gap-3 rounded-[5px] hover:bg-muted/50">{body}</Link> : <div className="flex items-center gap-3">{body}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Organizations you’re part of show here.</p>
      )}
      {isOwner ? (
        <Link href="/join" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          <Plus className="size-3.5" aria-hidden="true" /> Join with code
        </Link>
      ) : null}
      {isOwner ? <ManageOrganizationsDialog open={managing} onOpenChange={setManaging} /> : null}
    </RailSection>
  );
}

/** Manage organizations (report §38.2): a Show switch and the order, each saved at once. */
function ManageOrganizationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<MyProfileOrganization[] | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!open) return;
    let live = true;
    void readMyProfileOrganizationsAction().then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [open]);
  const saved = () => toast.success("Saved");
  const toggle = (row: MyProfileOrganization) => startTransition(async () => {
    const result = await updateMyOrgMembershipAction(row.orgId, { show_on_profile: !row.showOnProfile });
    if (!result.success) return void toast.error(result.error);
    setRows((current) => current?.map((r) => (r.orgId === row.orgId ? { ...r, showOnProfile: !r.showOnProfile } : r)) ?? null);
    saved();
  });
  const move = (index: number, by: -1 | 1) => startTransition(async () => {
    if (!rows) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    setRows(next);
    const result = await saveMyOrganizationOrderAction(next.map((r) => r.orgId));
    if (!result.success) return void toast.error(result.error);
    saved();
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) router.refresh(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage organizations</DialogTitle>
          <DialogDescription>Turning one off hides it, its contribution and its workspaces from others. Nothing is deleted.</DialogDescription>
        </DialogHeader>
        {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">You’re not in an organization yet. <Link href="/join" className="text-primary hover:underline">Join with code</Link></p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row, index) => (
              <li key={row.orgId} className="flex items-center gap-2 py-2.5 text-sm">
                <span className="flex flex-col">
                  <button type="button" aria-label={`Move ${row.title} up`} disabled={pending || index === 0} onClick={() => move(index, -1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label={`Move ${row.title} down`} disabled={pending || index === rows.length - 1} onClick={() => move(index, 1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                </span>
                <WorkspaceAvatar project={{ title: row.title, coverImage: row.coverImage }} size="row" placeholder />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{row.title}</span><span className="text-[12px] text-muted-foreground">{row.role}</span></span>
                <label className="flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" role="switch" checked={row.showOnProfile} disabled={pending} onChange={() => toggle(row)} aria-label={`Show ${row.title} on my profile`} />
                  Show
                </label>
                <Link href={profileEditHref("experience", "overview", { contribution: row.contributionId ?? undefined })} className="text-[13px] text-primary hover:underline">Edit contribution</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-muted-foreground">Private organizations show only to you and their members.</p>
        <div className="flex justify-end"><Button type="button" onClick={() => onOpenChange(false)}>Done</Button></div>
      </DialogContent>
    </Dialog>
  );
}
