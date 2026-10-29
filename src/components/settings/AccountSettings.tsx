"use client";

import Link from "next/link";
import { toast } from "@/lib/feedback";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Database, Loader2, LogOut } from "lucide-react";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SignOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";
import PendingDeletionBanner from "@/components/settings/PendingDeletionBanner";
import { useAccountDeletionStatus } from "@/hooks/useSettingsQueries";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import { cacheManager } from "@/lib/utils/cache-manager";
import { normalizeIdentityFields } from "@/lib/ui/identity";

export default function AccountPage() {
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const { data: deletionStatus = { pending: false } } =
    useAccountDeletionStatus();
  const queryClient = useQueryClient();
  const { profile, user, signOut } = useAuth();
  const handleDeletionCancelled = () => {
    queryClient.setQueryData(queryKeys.settings.accountDeletion(), {
      pending: false,
    });
  };

  const providers = Array.from(new Set((user?.identities ?? []).map((identity) => identity.provider))).map((provider) => provider === "email" ? "Email and password" : provider.charAt(0).toUpperCase() + provider.slice(1));
  const emailVerified = Boolean(user?.email_confirmed_at);

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      await cacheManager.clearStaticsOnly();
      toast.success("Application cache cleared");
    } catch {
      toast.error("Couldn’t clear the application cache");
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <>
      <div className="space-y-8">

        {deletionStatus.pending && deletionStatus.hardDeleteAt && (
          <PendingDeletionBanner
            hardDeleteAt={deletionStatus.hardDeleteAt}
            onCancelled={handleDeletionCancelled}
          />
        )}

        <SettingsSectionCard
          title="Account details"
          description="The identity attached to your signed-in NetworkBase account."
        >
          <div className="divide-y divide-border">
            <SettingsRow title="Name" right={<span className="nb-compact text-foreground">{profile?.fullName || normalizeIdentityFields(user?.user_metadata).fullName || "Not set"}</span>} />
            <SettingsRow title="Email" right={<span className="nb-compact break-all text-foreground">{profile?.email || user?.email || "Not available"}{user?.email ? <span className="ml-2 nb-meta text-muted-foreground">{emailVerified ? "Verified" : "Not verified"}</span> : null}</span>} />
            <SettingsRow title="Username" right={<span className="nb-meta text-foreground">{profile?.username ? `@${profile.username}` : profile ? "Not set" : <><span aria-hidden="true">…</span><span className="sr-only">Loading</span></>}</span>} />
            <SettingsRow title="Sign-in methods" description="Add or remove them in Security and Integrations." right={<span className="nb-compact text-foreground">{providers.length ? providers.join(", ") : "None"}</span>} />
          </div>
          <div className="mt-3">
            <Button asChild variant="outline" size="sm" className="pointer-coarse:h-11"><Link href="/my-profile/edit">Edit your profile</Link></Button>
            <span className="ml-3 nb-meta text-muted-foreground">Name and username are changed on your profile.</span>
          </div>
        </SettingsSectionCard>

        <SettingsSectionCard
          title="Storage on this device"
          description="Remove downloaded application files while preserving local drafts and appearance preferences."
        >
          <SettingsRow
            title="Storage on this device"
            description="NetworkBase downloads these files again when they are needed."
            right={
              <Button variant="outline" onClick={() => void handleClearCache()} disabled={isClearingCache}>
                {isClearingCache ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Database className="size-4" aria-hidden="true" />}
                {isClearingCache ? "Clearing…" : "Clear cache"}
              </Button>
            }
          />
        </SettingsSectionCard>

        <SettingsSectionCard
          title="Sign out"
          description="Safely sign out of your account on this device."
        >
          <SettingsRow
            title="This device"
            description="You will be signed out here only. Unsaved offline changes or drafts may be lost."
            right={
              <Button
                variant="outline"
                className="text-[var(--status-danger)] hover:bg-[var(--status-danger-soft)] hover:text-[var(--status-danger)]"
                onClick={() => setShowSignOutConfirm(true)}
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </Button>
            }
          />
        </SettingsSectionCard>
      </div>

      <SignOutConfirmDialog
        open={showSignOutConfirm}
        onOpenChange={setShowSignOutConfirm}
        onConfirm={signOut}
      />
    </>
  );
}
