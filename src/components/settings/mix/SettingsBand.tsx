"use client";

import Link from "next/link";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cancelAccountDeletion } from "@/app/actions/account";
import { SignOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";
import { useAppearance, useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/use-auth";
import { ACCENT_PALETTES, DENSITY_LABELS } from "@/lib/theme/appearance-runtime";
import { feedbackError, toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { padCount } from "@/lib/ui/tab-marker";
import { clockTime } from "@/lib/settings/format";
import { deletionDays } from "@/lib/settings/checkup";
import { normalizeIdentityFields } from "@/lib/ui/identity";
import { cn } from "@/lib/utils";
import { DeletionSquares } from "./parts";
import { useSettingsSummary } from "./useSettingsSummary";

const PROFILE_WORD = { public: "Anyone", connections: "Connections", private: "Only me" } as const;
const MESSAGES_WORD = { connections: "connections", everyone: "everyone" } as const;
const THEME_WORD = { system: "System", light: "Light", dark: "Dark" } as const;

/** The identity band at the top of Settings (mix): who, since when, and the five states that matter, each a jump. */
export function SettingsBand() {
  const summary = useSettingsSummary();
  const { theme } = useTheme();
  const { accentColor, density } = useAppearance();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const { user, profile } = summary;
  const name = profile?.fullName || normalizeIdentityFields(user?.user_metadata).fullName || profile?.username || "Your account";
  const since = user?.created_at ? new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(user.created_at)) : null;
  const sessions = summary.sessions;
  const deviceCount = sessions?.length ?? null;
  const privacy = summary.privacy;
  const paused = Boolean(summary.pausedUntil);

  const cancelDeletion = async () => {
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

  const stat = (href: string, label: string, value: string, line: string, hot = false) => (
    <Link href={href} className={cn("nbs-stat", hot && "hot")}>{label}<b>{value}</b><small>{line}</small></Link>
  );

  return (
    <section className="nbs-band" aria-label="Your account">
      <div className="nbs-band-in">
        <p className="nbs-eyebrow">Settings · <b>signed in</b>{since ? <> · since {since}</> : null}</p>
        <span className="nbs-pic">{profile ? <UserAvatar identity={profile} className="size-full" roundedClassName="rounded-none" sizes="76px" fallbackDisplayName={name} /> : null}</span>
        <div className="nbs-who">
          <p className="nbs-name">{name}</p>
          <div className="nbs-ids">{profile?.username ? <span>@{profile.username}</span> : null}{profile?.email || user?.email ? <span>{profile?.email || user?.email}</span> : null}</div>
        </div>
        <div className="nbs-acts">
          <Button asChild variant="outline" size="sm" className="nbs-band-btn"><Link href="/my-profile/edit">Edit profile</Link></Button>
          <Button type="button" variant="outline" size="sm" className="nbs-band-btn danger" onClick={() => setSignOutOpen(true)}><LogOut className="size-4" aria-hidden="true" />Sign out</Button>
        </div>
      </div>
      <nav className="nbs-stats" aria-label="Your settings at a glance">
        {stat("/settings#settings-security-twostep", "Two-step", summary.securityKnown ? (summary.twoStepOn ? "On" : "Off") : "…", summary.securityKnown ? (summary.twoStepOn ? "Authenticator app" : "Not protected yet") : "Loading", summary.securityKnown && !summary.twoStepOn)}
        {stat("/settings#settings-security-sessions", "Devices", deviceCount === null ? "…" : padCount(deviceCount), deviceCount === null ? "Loading" : deviceCount <= 1 ? "Only this device" : `This device and ${deviceCount - 1} other${deviceCount === 2 ? "" : "s"}`)}
        {stat("/settings#settings-privacy-reach", "Profile", privacy ? PROFILE_WORD[privacy.profileVisibility as keyof typeof PROFILE_WORD] ?? "Anyone" : "…", privacy ? `Messages: ${MESSAGES_WORD[privacy.messagePrivacy as keyof typeof MESSAGES_WORD] ?? "connections"}` : "Loading")}
        {stat("/settings#settings-notifications-pause", "Notifications", paused ? "Paused" : summary.typesOn === null ? "…" : `${padCount(summary.typesOn)} / ${padCount(summary.typesTotal)}`, paused ? `Until ${clockTime(summary.pausedUntil)}` : "Types on", paused)}
        {stat("/settings#settings-appearance-theme", "Theme", THEME_WORD[theme as keyof typeof THEME_WORD] ?? "System", `${ACCENT_PALETTES[accentColor]?.label ?? "Clay"}, ${DENSITY_LABELS[density]?.label.toLowerCase() ?? "default"}`)}
      </nav>
      {summary.hardDeleteAt ? (
        <div className="nbs-strip" role="status">
          <b>Deleting</b>
          <span>Removed on <span className="nbs-mono">{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(summary.hardDeleteAt))}</span> · {deletionDays(summary.hardDeleteAt).left} days left</span>
          <DeletionSquares hardDeleteAt={summary.hardDeleteAt} />
          <Button type="button" variant="outline" size="sm" pending={cancelling} onClick={() => void cancelDeletion()}>Cancel deletion</Button>
        </div>
      ) : null}
      <SignOutConfirmDialog open={signOutOpen} onOpenChange={setSignOutOpen} onConfirm={signOut} />
    </section>
  );
}
