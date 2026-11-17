"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { createBranchAction } from "@/app/actions/files/branches";
import { getProtectionAction, saveToNewBranchAction } from "@/app/actions/files/merge-requests";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/lib/feedback";
import type { ProtectedChange } from "@/lib/domain/branches";

/** The database's refusal on a protected main (0099), however the action reported it. */
export const isProtectedMain = (value: unknown) =>
  /BRANCH_PROTECTED|main is protected/.test(value instanceof Error ? value.message : typeof value === "string" ? value : "");

/** Whether main takes only merge requests here (false while Branches is off), shared with Settings' query. */
export function useMainProtected(projectId: string) {
  const query = useQuery({
    queryKey: ["project", projectId, "protection"],
    staleTime: 30_000,
    queryFn: async () => { const res = await getProtectionAction(projectId); return res.success ? res.data : null; },
  });
  return Boolean(query.data?.rules.requireMergeRequest);
}

/** A merge request's page in the Files tab. */
export function mergeRequestHref(n: number) {
  const url = new URL(window.location.href);
  for (const k of ["branch", "bpath", "bfile", "save", "changes", "path", "fileId"]) url.searchParams.delete(k);
  url.searchParams.set("filesView", "merge-requests");
  url.searchParams.set("mr", String(n));
  return url.toString();
}

/** A revert on a protected main became a branch with a merge request (H5): say so and open it. */
export function openRevertRequest(res: { branch?: string; mergeRequest?: number }) {
  if (!res.mergeRequest) return;
  toast.success(`main is protected: the revert is on ${res.branch ?? "a branch"} as merge request !${res.mergeRequest}`);
  window.location.assign(mergeRequestHref(res.mergeRequest));
}

const slug = (text: string) => text.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "change";

/**
 * Protected main (report H5): an edit, "Use this version" or a restore that main refused is offered on a new branch,
 * named `<you>/<what>`, with a merge request opened for review. `offer` opens the dialog; it does the rest.
 */
export function useSaveToBranch(projectId: string) {
  const { profile } = useAuth() as { profile?: { username?: string | null } | null };
  const [pending, setPending] = useState<{ title: string; what: string; change: ProtectedChange; onDone?: () => void } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const offer = (input: { title: string; what: string; change: ProtectedChange; onDone?: () => void }) => {
    setName(`${(profile?.username ?? "me").toLowerCase()}/${slug(input.what)}`);
    setPending(input);
  };
  async function save() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const res = await saveToNewBranchAction(projectId, { name: name.trim(), title: pending.title, change: pending.change });
      if (!res.success) { toast.error(res.error); return; }
      const href = mergeRequestHref(res.data.mergeRequest);
      toast.success(`Saved to ${res.data.branch.name}; opened merge request !${res.data.mergeRequest}`, { action: { label: "Open", onClick: () => window.location.assign(href) } });
      pending.onDone?.();
      setPending(null);
    } finally {
      setBusy(false);
    }
  }
  const dialog = (
    <ConfirmDialog
      open={Boolean(pending)}
      onOpenChange={(open) => { if (!open && !busy) setPending(null); }}
      title="main is protected. Save to a new branch?"
      description="main changes only through merge requests. This goes on a new branch, and a merge request opens for review."
      confirmLabel={busy ? "Saving…" : "Save to branch"}
      autoCloseOnConfirm={false}
      loading={busy}
      onConfirm={() => void save()}
    >
      <label htmlFor="save-to-branch-name" className="nb-compact font-medium">Branch name</label>
      <input id="save-to-branch-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100}
        className="mt-1 h-8 w-full rounded-[5px] border border-border bg-card px-2 font-mono text-xs text-foreground focus:border-[#D14E24] focus:outline-none" />
    </ConfirmDialog>
  );
  return { offer, dialog };
}

// ── Uploads and drops on a protected main (H5, H24) ───────────────────────────────────────────────────────────────

type PendingUpload = { files: File[]; folder: string };
const pendingUploads = new Map<string, PendingUpload>();
/** The explorer asks; the offer below answers (it lives with the branch picker). */
export function offerUploadToBranch(projectId: string, upload: PendingUpload) {
  window.dispatchEvent(new CustomEvent("nb:protected-upload", { detail: { projectId, ...upload } }));
}
/** The branch's folder view takes the files once, when it opens. */
export function takePendingUpload(branchId: string) {
  const p = pendingUploads.get(branchId);
  pendingUploads.delete(branchId);
  return p ?? null;
}

/**
 * "main is protected. Upload to a new branch?": makes the branch from main, switches Files to it, and the branch's
 * folder uploads the same files there (with its key check and "Verify it's you"); its bar opens the merge request.
 */
export function ProtectedUploadOffer({ projectId, onBranch }: { projectId: string; onBranch: (name: string) => void }) {
  const { profile } = useAuth() as { profile?: { username?: string | null } | null };
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (event: Event) => {
      const d = (event as CustomEvent<PendingUpload & { projectId: string }>).detail;
      if (d?.projectId !== projectId) return;
      setName(`${(profile?.username ?? "me").toLowerCase()}/upload-${new Date().toISOString().slice(0, 10)}`);
      setPending({ files: d.files, folder: d.folder });
    };
    window.addEventListener("nb:protected-upload", on);
    return () => window.removeEventListener("nb:protected-upload", on);
  }, [projectId, profile?.username]);
  async function go() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const res = await createBranchAction(projectId, name.trim(), "main");
      if (!res.success) { toast.error(res.error); return; }
      pendingUploads.set(res.data.branch.id, pending);
      setPending(null);
      onBranch(res.data.branch.name);
    } finally { setBusy(false); }
  }
  const count = pending?.files.length ?? 0;
  return (
    <ConfirmDialog
      open={Boolean(pending)}
      onOpenChange={(open) => { if (!open && !busy) setPending(null); }}
      title="main is protected. Upload to a new branch?"
      description={`main changes only through merge requests. ${count === 1 ? "The file goes" : `The ${count} files go`} on a new branch; open a merge request from its bar when you're ready.`}
      confirmLabel={busy ? "Making the branch…" : "Upload to branch"}
      autoCloseOnConfirm={false}
      loading={busy}
      onConfirm={() => void go()}
    >
      <label htmlFor="upload-branch-name" className="nb-compact font-medium">Branch name</label>
      <input id="upload-branch-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100}
        className="mt-1 h-8 w-full rounded-[5px] border border-border bg-card px-2 font-mono text-xs text-foreground focus:border-[#D14E24] focus:outline-none" />
    </ConfirmDialog>
  );
}
