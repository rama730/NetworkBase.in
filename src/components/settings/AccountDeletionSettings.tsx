"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "@/lib/feedback";
import AccountDeletionWizard from "@/components/settings/AccountDeletionWizard";
import { Button } from "@/components/ui/button";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { useAccountDeletionStatus } from "@/hooks/useSettingsQueries";

export default function AccountDeletionSettings() {
  const [showDeleteWizard, setShowDeleteWizard] = useState(false);
  const { data: deletionStatus = { pending: false } } = useAccountDeletionStatus();
  const router = useRouter();

  const handleDeleted = () => {
    setShowDeleteWizard(false);
    toast.success("Account scheduled for deletion");
    router.push("/login");
  };

  return <>
    <SettingsSectionCard title="Delete account" description="This permanent account action is placed last so it cannot be mistaken for a routine setting.">
      <SettingsRow
        title={deletionStatus.pending ? "Deletion scheduled" : "Permanently delete this account"}
        description={deletionStatus.pending ? "Your account is scheduled for deletion." : "Delete your account and all associated data after the recovery period."}
        right={<Button variant="destructive" onClick={() => setShowDeleteWizard(true)} disabled={deletionStatus.pending}>
          <Trash2 className="size-4" strokeWidth={1.75} />
          {deletionStatus.pending ? "Pending" : "Delete account"}
        </Button>}
      />
    </SettingsSectionCard>

    {showDeleteWizard ? <AccountDeletionWizard onClose={() => setShowDeleteWizard(false)} onDeleted={handleDeleted} /> : null}
  </>;
}
