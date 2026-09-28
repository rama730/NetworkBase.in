"use client";

import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Database, Loader2, LogOut } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import PendingDeletionBanner from "@/components/settings/PendingDeletionBanner";
import { useAccountDeletionStatus } from "@/hooks/useSettingsQueries";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import { cacheManager } from "@/lib/utils/cache-manager";
import { normalizeIdentityFields } from "@/lib/ui/identity";

export default function AccountPage({ embedded = false }: { embedded?: boolean }) {
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { data: deletionStatus = { pending: false } } =
    useAccountDeletionStatus();
  const queryClient = useQueryClient();
  const { profile, user, signOut } = useAuth();
  const handleDeletionCancelled = () => {
    queryClient.setQueryData(queryKeys.settings.accountDeletion(), {
      pending: false,
    });
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      await cacheManager.clearStaticsOnly();
      toast.success("Application cache cleared");
    } catch {
      toast.error("Could not clear the application cache");
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        {!embedded ? (
          <SettingsPageHeader
            title="Account"
            description="Manage your signed-in account, local app data, and account actions."
          />
        ) : null}

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
            <SettingsRow title="Email" right={<span className="nb-compact text-foreground">{profile?.email || user?.email || "Not available"}</span>} />
            <SettingsRow title="Username" right={<span className="nb-meta text-foreground">{profile?.username ? `@${profile.username}` : "Not set"}</span>} />
          </div>
        </SettingsSectionCard>

        <SettingsSectionCard
          title="Cache management"
          description="Remove downloaded application files while preserving local drafts and appearance preferences."
        >
          <SettingsRow
            title="Application cache"
            description="NetworkBase downloads these files again when they are needed."
            right={
              <Button variant="outline" onClick={() => void handleClearCache()} disabled={isClearingCache}>
                {isClearingCache ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
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
            title="Active session"
            description="You will be signed out on this device. Unsaved offline changes or drafts may be lost."
            right={
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setShowSignOutConfirm(true)}
                disabled={isSigningOut}
              >
                {isSigningOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                Sign out
              </Button>
            }
          />
        </SettingsSectionCard>
      </div>

      <ConfirmDialog
        open={showSignOutConfirm}
        onOpenChange={setShowSignOutConfirm}
        title="Sign out of your account?"
        description="You will be signed out on this device. Unsaved offline changes or drafts may be lost."
        confirmLabel="Sign out"
        variant="destructive"
        loading={isSigningOut}
        onConfirm={async () => {
          setIsSigningOut(true);
          try {
            await signOut();
            toast.info("Signed out successfully");
          } catch {
            toast.error("Failed to sign out. Please try again.");
          } finally {
            setIsSigningOut(false);
          }
        }}
      />
    </>
  );
}
