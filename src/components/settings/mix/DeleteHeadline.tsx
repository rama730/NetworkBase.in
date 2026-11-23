"use client";

import { useAccountDeletionStatus } from "@/hooks/useSettingsQueries";

/** While a deletion is scheduled the closing frame says so instead of offering it. */
export function DeleteHeadline() {
  const { data } = useAccountDeletionStatus();
  return <h2 id="settings-delete-account-heading" tabIndex={-1}>{data?.pending ? "Your account is being deleted." : "Delete your account."}</h2>;
}
