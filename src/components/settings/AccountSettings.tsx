"use client";

import Link from "next/link";
import { useState } from "react";
import { Database, LogOut } from "lucide-react";
import { toast } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SignOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";
import { Tag } from "@/components/settings/mix/parts";
import { useSendVerification } from "@/components/settings/mix/SettingsCheckup";
import { SavedTick } from "@/components/ui/SavedTick";
import { useAuth } from "@/hooks/use-auth";
import { cacheManager } from "@/lib/utils/cache-manager";
import { normalizeIdentityFields } from "@/lib/ui/identity";

/** Account (settings mix v2): what you act on here. Name, username and picture are one row that opens your profile. */
export default function AccountPage() {
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(0);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const { profile, user, signOut } = useAuth();
  const verify = useSendVerification();
  const email = profile?.email || user?.email || null;
  const emailVerified = Boolean(user?.email_confirmed_at);
  const name = profile?.fullName || normalizeIdentityFields(user?.user_metadata).fullName || null;

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      await cacheManager.clearStaticsOnly();
      setCacheCleared((n) => n + 1);
    } catch {
      toast.error("Couldn’t clear the application cache");
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <>
      <SettingsSectionCard id="settings-account-email" title="Email" state={email && !emailVerified ? "verify" : undefined} flush findKeys="email address">
        <SettingsRows>
          <SettingsRow
            title={email ?? "No email on this account"}
            description={!email ? undefined : emailVerified ? "Verified. Security emails and assignments come here." : verify.state === "sent" ? "Link sent. Open it from your inbox, then come back." : "Not verified yet. Security emails and sign-in links need a verified address."}
            right={!email ? null : emailVerified ? <Tag tone="ok" tick>Verified</Tag> : <>
              <Tag tone="warn">Not verified</Tag>
              {verify.state === "sent" ? <span className="nbs-meta">Sent</span> : <Button type="button" variant="outline" size="sm" pending={verify.state === "sending"} onClick={() => void verify.send()}>Send link</Button>}
            </>}
          />
          <SettingsRow
            id="settings-account-profile"
            title="Name, username and picture"
            description={[name, profile?.username ? `@${profile.username}` : null].filter(Boolean).join(" · ") || "Not set yet"}
            right={<Button asChild variant="outline" size="sm"><Link href="/my-profile/edit">Edit profile</Link></Button>}
          />
        </SettingsRows>
      </SettingsSectionCard>

      <SettingsSectionCard id="settings-account-device" title="This device" flush>
        <SettingsRows>
          <SettingsRow
            id="settings-account-cache"
            title="Storage"
            description="Downloaded app files. Drafts and appearance stay; the rest downloads again when needed."
            right={<>
              {cacheCleared ? <SavedTick key={cacheCleared} label="Cleared" /> : null}
              <Button pending={isClearingCache} variant="outline" size="sm" onClick={() => void handleClearCache()} disabled={isClearingCache}>
                <Database className="size-4" aria-hidden="true" />Clear cache
              </Button>
            </>}
          />
          <SettingsRow
            id="settings-account-signout"
            title="Sign out"
            description="Signs you out here only. Unsaved offline drafts may be lost."
            right={<Button variant="outline" size="sm" className="text-[var(--status-danger)] hover:bg-[var(--status-danger-soft)] hover:text-[var(--status-danger)]" onClick={() => setShowSignOutConfirm(true)}>
              <LogOut className="size-4" aria-hidden="true" />Sign out
            </Button>}
          />
        </SettingsRows>
      </SettingsSectionCard>

      <SignOutConfirmDialog open={showSignOutConfirm} onOpenChange={setShowSignOutConfirm} onConfirm={signOut} />
    </>
  );
}
