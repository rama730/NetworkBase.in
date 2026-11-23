"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelAccountDeletion } from "@/app/actions/account";
import { toast, feedbackError } from "@/lib/feedback";
import AccountDeletionWizard from "@/components/settings/AccountDeletionWizard";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { PixelPlace } from "@/components/ui/PixelPerson";
import { DeletionSquares, Tag } from "@/components/settings/mix/parts";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { useAccountDeletionStatus } from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { deletionDays } from "@/lib/settings/checkup";
import { formatCalendarDate } from "@/lib/ui/date-formatting";

type OwnedProject = { id: string; title: string; slug: string | null; otherMembers: number; kind?: string; handover?: boolean };

/** What deleting does to each workspace you own, in the deletion check's own terms. */
function impact(project: OwnedProject): { line: string; tag: string; tone?: "bad" | "warn" } {
  const others = `${project.otherMembers} other member${project.otherMembers === 1 ? "" : "s"}`;
  if (project.kind === "organization") return { line: `organization · hand it over or delete it first`, tag: "Blocks deletion", tone: "warn" };
  if (project.handover) return { line: `${others} · goes to a new owner`, tag: "Handed over" };
  if (project.otherMembers > 0) return { line: `${others} · deleted for them too`, tag: "Deleted", tone: "bad" };
  return { line: "only you · deleted with your account", tag: "Deleted", tone: "bad" };
}

/** Delete account (settings mix v2): export first, what happens to your workspaces, then delete; while scheduled, the 30 days and Cancel. */
export default function AccountDeletionSettings() {
  const [showDeleteWizard, setShowDeleteWizard] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { data: deletionStatus, isLoading, isError, refetch } = useAccountDeletionStatus();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pending = Boolean(deletionStatus?.pending);
  const preflight = useQuery({
    queryKey: [...queryKeys.settings.accountDeletion(), "preflight"],
    enabled: !pending && !isLoading,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch("/api/v1/account/deletion-preflight", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error("Couldn’t check your workspaces");
      return (payload?.data?.projects ?? []) as OwnedProject[];
    },
  });

  const handleDeleted = (hardDeleteAt: string | null) => {
    setShowDeleteWizard(false);
    toast.success(hardDeleteAt
      ? `Account scheduled for deletion on ${formatCalendarDate(hardDeleteAt)}. Sign in before then to cancel.`
      : "Account scheduled for deletion. Sign in within 30 days to cancel.");
    // The server already signed this browser out: nothing of this account should stay in memory.
    queryClient.clear();
    router.replace("/login");
  };
  const cancel = async () => {
    setCancelling(true);
    try {
      const result = await cancelAccountDeletion();
      if (!result.success) throw new Error(result.error || "Couldn’t cancel deletion");
      queryClient.setQueryData(queryKeys.settings.accountDeletion(), { pending: false });
      toast.success("Deletion cancelled. Your account stays.");
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t cancel deletion"));
    } finally {
      setCancelling(false);
    }
  };

  // Unknown is not "safe to delete": the button waits for a real answer.
  const unknown = isLoading || isError;
  const hardDeleteAt = pending ? deletionStatus?.hardDeleteAt ?? null : null;
  const left = hardDeleteAt ? deletionDays(hardDeleteAt).left : null;

  return <>
    {isError ? <div className="nbs-body pt-4"><ErrorNotice what="Your deletion status" onRetry={() => void refetch()} /></div> : null}
    {pending ? null : <p className="nbs-callout">Want a copy first? <a href="#settings-privacy-policies-export">Export your data</a> before you delete.</p>}

    {pending ? null : (
      <SettingsSectionCard id="settings-delete-impact" title="What happens to your workspaces" flush findKeys="workspaces owner handover">
        {preflight.isError ? <div className="nbs-body"><ErrorNotice what="Your workspaces" onRetry={() => void preflight.refetch()} /></div>
          : !preflight.data ? <p role="status" className="nbs-ghelp">Checking your workspaces…</p>
          : preflight.data.length === 0 ? <p className="nbs-ghelp">You own no workspaces. You leave the ones you’re a member of; they stay.</p>
          : <div className="nbs-impact">{preflight.data.map((project) => {
            const what = impact(project);
            return <div key={project.id}>
              <span className="px" aria-hidden="true"><PixelPlace kind={project.kind === "organization" ? "organization" : "workspace"} identityKey={project.id} size={30} /></span>
              <span className="min-w-0">{project.title}<br /><span className="nbs-meta">{what.line}</span></span>
              <Tag tone={what.tone}>{what.tag}</Tag>
            </div>;
          })}</div>}
      </SettingsSectionCard>
    )}

    <SettingsRows>
      {pending ? (
        <SettingsRow id="settings-delete-scheduled" title={`Deletion scheduled · ${left} day${left === 1 ? "" : "s"} left`}
          description={hardDeleteAt ? `It’s removed on ${formatCalendarDate(hardDeleteAt)}. Your profile is hidden until then; cancel and everything comes back.` : "Your profile is hidden until then."}
          meta={hardDeleteAt ? <span className="mt-1 inline-block"><DeletionSquares hardDeleteAt={hardDeleteAt} /></span> : undefined}
          right={<Button size="sm" pending={cancelling} onClick={() => void cancel()}>Cancel deletion</Button>} />
      ) : (
        <SettingsRow id="settings-delete-row" title="Delete this account"
          description="Your profile is hidden at once. You can cancel during the 30 days; after that it can’t be undone."
          right={<Button variant="destructive" size="sm" onClick={() => setShowDeleteWizard(true)} disabled={unknown}>Delete account…</Button>} />
      )}
    </SettingsRows>

    {showDeleteWizard ? <AccountDeletionWizard onClose={() => setShowDeleteWizard(false)} onDeleted={handleDeleted} /> : null}
  </>;
}
