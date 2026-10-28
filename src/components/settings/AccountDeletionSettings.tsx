"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "@/lib/feedback";
import AccountDeletionWizard from "@/components/settings/AccountDeletionWizard";
import PendingDeletionBanner from "@/components/settings/PendingDeletionBanner";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { useAccountDeletionStatus } from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { formatCalendarDate } from "@/lib/ui/date-formatting";

export default function AccountDeletionSettings() {
  const [showDeleteWizard, setShowDeleteWizard] = useState(false);
  const { data: deletionStatus, isLoading, isError, refetch } = useAccountDeletionStatus();
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleDeleted = (hardDeleteAt: string | null) => {
    setShowDeleteWizard(false);
    toast.success(hardDeleteAt
      ? `Account scheduled for deletion on ${formatCalendarDate(hardDeleteAt)}. Sign in before then to cancel.`
      : "Account scheduled for deletion. Sign in within 30 days to cancel.");
    // The server already signed this browser out: nothing of this account should stay in memory.
    queryClient.clear();
    router.push("/login");
  };

  const pending = Boolean(deletionStatus?.pending);
  // Unknown is not "safe to delete": the button waits for a real answer.
  const unknown = isLoading || isError;

  return <>
    <SettingsSectionCard title="Delete account" description="Permanently delete your account and everything in it, after a 30-day recovery period.">
      {isError ? <ErrorNotice what="Your deletion status" onRetry={() => void refetch()} className="mb-3" /> : null}
      {pending && deletionStatus?.hardDeleteAt ? (
        <PendingDeletionBanner
          hardDeleteAt={deletionStatus.hardDeleteAt}
          onCancelled={() => queryClient.setQueryData(queryKeys.settings.accountDeletion(), { pending: false })}
        />
      ) : (
        <SettingsRow
          title="Permanently delete this account"
          description="Your profile is hidden at once. You can cancel during the 30 days."
          right={<Button variant="destructive" onClick={() => setShowDeleteWizard(true)} disabled={unknown || pending}>
            <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Delete account
          </Button>}
        />
      )}
    </SettingsSectionCard>

    {showDeleteWizard ? <AccountDeletionWizard onClose={() => setShowDeleteWizard(false)} onDeleted={handleDeleted} /> : null}
  </>;
}
