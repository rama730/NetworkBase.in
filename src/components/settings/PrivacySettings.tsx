"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, ShieldBan, Users } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SearchField } from "@/components/ui/SearchField";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsRadioGroup } from "@/components/settings/ui/SettingsRadioGroup";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsStatusChips } from "@/components/settings/ui/SettingsStatusChips";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { usePrivacySettings } from "@/hooks/useSettingsQueries";
import { invalidatePrivacyDependents } from "@/lib/privacy/client-invalidation";
import type { ConnectionPrivacySetting, MessagePrivacySetting, ProfileVisibilitySetting } from "@/lib/privacy/relationship-state";
import { profileHref } from "@/lib/routing/identifiers";
import type { PrivacyBlockedAccount } from "@/types/settingsTypes";
import { formatCalendarDate, formatDateTime } from "@/lib/ui/date-formatting";
import { MESSAGE_PRIVACY_CHOICES, VISIBILITY_CHOICES } from "@/lib/onboarding/contracts";

// One wording for these choices, shared with onboarding.
const VISIBILITY_COPY = Object.fromEntries(VISIBILITY_CHOICES.map((choice) => [choice.value, choice])) as Record<(typeof VISIBILITY_CHOICES)[number]["value"], (typeof VISIBILITY_CHOICES)[number]>;
const MESSAGE_COPY = Object.fromEntries(MESSAGE_PRIVACY_CHOICES.map((choice) => [choice.value, choice])) as Record<(typeof MESSAGE_PRIVACY_CHOICES)[number]["value"], (typeof MESSAGE_PRIVACY_CHOICES)[number]>;

const VISIBILITY_OPTIONS = [
  { value: "public" as const, label: VISIBILITY_COPY.public.label, description: VISIBILITY_COPY.public.description, icon: Globe },
  { value: "connections" as const, label: VISIBILITY_COPY.connections.label, description: VISIBILITY_COPY.connections.description, icon: Users },
  { value: "private" as const, label: VISIBILITY_COPY.private.label, description: VISIBILITY_COPY.private.description, icon: Lock },
];
const MESSAGE_OPTIONS = [
  { value: "connections" as const, label: MESSAGE_COPY.connections.label, description: MESSAGE_COPY.connections.description },
  { value: "everyone" as const, label: MESSAGE_COPY.everyone.label, description: MESSAGE_COPY.everyone.description },
];
const CONNECTION_OPTIONS = [
  { value: "everyone" as const, label: "Everyone", description: "Any eligible account." },
  { value: "mutuals_only" as const, label: "Mutual connections", description: "People who share a connection." },
  { value: "nobody" as const, label: "Nobody", description: "Do not accept new requests." },
];

async function patchPrivacy(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error((typeof json?.error === "string" && json.error) || (typeof json?.message === "string" && json.message) || "Failed to update privacy settings");
  return json?.data;
}

async function fetchBlockedPage(cursor: string) {
  const res = await fetch(`/api/v1/privacy/blocks?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error("Failed to load more blocked accounts");
  return json.data as { accounts: PrivacyBlockedAccount[]; nextCursor: string | null };
}

async function unblockAccount(userId: string) {
  const res = await fetch(`/api/v1/privacy/blocks/${userId}`, { method: "DELETE" });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error((typeof json?.error === "string" && json.error) || (typeof json?.message === "string" && json.message) || "Failed to unblock account");
  return json?.data;
}

function BlockedAccountRow({ account, onUnblock, isPending }: { account: PrivacyBlockedAccount; onUnblock: (account: PrivacyBlockedAccount) => void; isPending: boolean }) {
  const displayName = account.fullName || account.username || "Unknown user";
  return <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar identity={account} size={40} fallbackDisplayName={displayName} fallbackClassName="text-sm font-semibold text-primary-foreground" />
      <div className="min-w-0">
        <Link href={profileHref(account)} className="block truncate nb-ui-label text-foreground hover:text-primary">{displayName}</Link>
        <p className="truncate nb-meta text-muted-foreground">{account.username ? `@${account.username}` : account.headline || "NetworkBase member"}</p>
        {account.username && account.headline ? <p className="truncate nb-meta text-muted-foreground">{account.headline}</p> : null}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-3">
      <span className="hidden nb-meta text-muted-foreground sm:inline">{account.blockedAt ? <>Blocked <time dateTime={account.blockedAt}>{formatCalendarDate(account.blockedAt)}</time></> : "Blocked"}</span>
      <Button type="button" variant="outline" size="sm" aria-label={`Unblock ${displayName}`} onClick={() => onUnblock(account)} disabled={isPending} className="pointer-coarse:h-11">{isPending ? "Unblocking…" : "Unblock"}</Button>
    </div>
  </div>;
}

type Confirmation = { title: string; description: string; confirmLabel: string; run: () => void };

export default function PrivacySettings({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = usePrivacySettings();
  const [blockedSearch, setBlockedSearch] = useState("");
  // Pages after the first one; dropped whenever the first page is refetched (unblock, refresh).
  const [more, setMore] = useState<{ base: PrivacyBlockedAccount[] | undefined; accounts: PrivacyBlockedAccount[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const refreshPrivacy = async () => { await invalidatePrivacyDependents(queryClient); };
  const updateMutation = useMutation({
    mutationFn: (update: { url: string; body: Record<string, unknown>; successMessage: string }) => patchPrivacy(update.url, update.body),
    onSuccess: async (_data, update) => { toast.success(update.successMessage); await refreshPrivacy(); },
    onError: (error) => toast.error(feedbackError(error instanceof Error ? error.message : "Failed to update privacy settings", "Failed to update privacy settings")),
  });
  const unblockMutation = useMutation({
    mutationFn: unblockAccount,
    onSuccess: async () => { toast.success("Account unblocked"); setMore(null); await refreshPrivacy(); },
    onError: (error) => toast.error(feedbackError(error instanceof Error ? error.message : "Failed to unblock account", "Failed to unblock account")),
  });

  const settings = data?.settings;
  const busy = updateMutation.isPending;
  const blockedQuery = blockedSearch.trim().toLowerCase();
  const extra = more && more.base === data?.blockedAccounts ? more : null;
  const blockedAccounts = [...(data?.blockedAccounts ?? []), ...(extra?.accounts ?? [])];
  const nextBlockedCursor = extra ? extra.cursor : (data?.blockedAccountsNextCursor ?? null);
  const loadMoreBlocked = async () => {
    if (!nextBlockedCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchBlockedPage(nextBlockedCursor);
      setMore({ base: data?.blockedAccounts, accounts: [...(extra?.accounts ?? []), ...page.accounts], cursor: page.nextCursor });
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Failed to load more blocked accounts", "Failed to load more blocked accounts"));
    } finally {
      setLoadingMore(false);
    }
  };
  const filteredBlockedAccounts = blockedAccounts.filter((account) => !blockedQuery || [account.fullName, account.username, account.headline].filter(Boolean).join(" ").toLowerCase().includes(blockedQuery));
  const recentPrivacyActivity = (data?.privacyActivity ?? []).slice(0, 4);
  const change = (url: string, body: Record<string, unknown>, successMessage: string) => updateMutation.mutate({ url, body, successMessage });
  const handleProfileVisibilityChange = (visibility: ProfileVisibilitySetting) => {
    if (visibility === "private") {
      setConfirmation({ title: "Make your profile private?", description: "Strangers will only see a locked profile shell.", confirmLabel: "Make private", run: () => change("/api/v1/privacy", { visibility }, "Profile visibility updated") });
      return;
    }
    change("/api/v1/privacy", { visibility }, "Profile visibility updated");
  };
  const handleConnectionPrivacyChange = (connectionPrivacy: ConnectionPrivacySetting) => {
    if (connectionPrivacy === "nobody") {
      setConfirmation({ title: "Turn off new connection requests?", description: "People will no longer be able to send you new requests. Existing connections are not affected.", confirmLabel: "Turn off", run: () => change("/api/v1/privacy", { connectionPrivacy }, "Connection request privacy updated") });
      return;
    }
    change("/api/v1/privacy", { connectionPrivacy }, "Connection request privacy updated");
  };
  const handleMessagePrivacyChange = (messagePrivacy: MessagePrivacySetting) => change("/api/v1/privacy", { messagePrivacy }, "Messaging privacy updated");
  const handleUnblock = (account: PrivacyBlockedAccount) => {
    const name = account.fullName || account.username || "this account";
    setConfirmation({ title: `Unblock ${name}?`, description: "Future requests and messages from them will follow your privacy settings again.", confirmLabel: "Unblock", run: () => unblockMutation.mutate(account.id) });
  };

  if (isLoading) return <SettingsSectionsSkeleton />;
  // Without the data there is nothing true to show: not "no blocked accounts", and no options that look unset.
  if (isError || !data) return <ErrorNotice what="Privacy settings" onRetry={() => void refetch()} />;

  return <div className={embedded ? "space-y-8" : "space-y-6"}>
    {!embedded ? <SettingsPageHeader title="Privacy" description="Control profile visibility, interactions, and blocked accounts." /> : null}

    <SettingsStatusChips
      label="Privacy summary"
      items={[
        { label: "Profile", value: VISIBILITY_COPY[settings?.profileVisibility ?? "public"]?.label ?? "Public", href: "/settings#settings-privacy-visibility" },
        { label: "Messages", value: MESSAGE_COPY[settings?.messagePrivacy ?? "connections"]?.label ?? "Connections", href: "/settings#settings-privacy-messages" },
        { label: "Requests", value: CONNECTION_OPTIONS.find((option) => option.value === settings?.connectionPrivacy)?.label ?? "Everyone", href: "/settings#settings-privacy-requests" },
        { label: "Blocked", value: String(data.blockedAccounts.length) + (data.blockedAccountsNextCursor ? "+" : ""), href: "/settings#settings-privacy-blocked" },
      ]}
    />

    <SettingsSectionCard title="Who can see and reach you" description="Choose who can view your profile and contact you.">
      <SettingsRadioGroup id="settings-privacy-visibility" label="Profile visibility" description="Choose who can open your full profile." value={settings?.profileVisibility} onValueChange={handleProfileVisibilityChange} options={VISIBILITY_OPTIONS} busy={busy} />

      <div className="my-6 border-t border-border" />
      <SettingsRadioGroup id="settings-privacy-messages" label="Messages" description="Choose who can start a direct conversation with you. Project invitations and applications still reach you." value={settings?.messagePrivacy} onValueChange={handleMessagePrivacyChange} options={MESSAGE_OPTIONS} busy={busy} optionsClassName="sm:grid-cols-2" />

      <div className="my-6 border-t border-border" />
      <SettingsRadioGroup id="settings-privacy-requests" label="Connection requests" description="Choose who can send you a connection request." value={settings?.connectionPrivacy} onValueChange={handleConnectionPrivacyChange} options={CONNECTION_OPTIONS} busy={busy} optionsClassName="md:grid-cols-3" />
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-privacy-blocked" title="Blocked accounts and activity" description="Manage blocked people and review recent privacy changes.">
      {data.blockedAccounts.length > 0 ? <SearchField label="Search blocked accounts" value={blockedSearch} onChange={setBlockedSearch} className="mb-3" /> : null}
      {data.blockedAccounts.length === 0 ? <div className="flex min-h-24 items-center gap-3 rounded-md border border-dashed border-border bg-card px-4"><ShieldBan className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" /><div><p className="nb-ui-label text-foreground">No blocked accounts</p><p className="nb-compact mt-1 text-muted-foreground">Blocked people will appear here.</p></div></div> : filteredBlockedAccounts.length === 0 ? <p className="py-6 text-center nb-compact text-muted-foreground">No blocked accounts match your search.</p> : <div>{filteredBlockedAccounts.map((account) => <BlockedAccountRow key={account.id} account={account} isPending={unblockMutation.isPending && unblockMutation.variables === account.id} onUnblock={handleUnblock} />)}</div>}
      {blockedQuery && nextBlockedCursor ? <p className="mt-2 nb-meta text-muted-foreground">Search covers the accounts loaded so far.</p> : null}
      {nextBlockedCursor ? <div className="mt-3 flex justify-center"><Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={loadMoreBlocked} className="pointer-coarse:h-11">{loadingMore ? "Loading…" : "Load more"}</Button></div> : null}

      <div className="my-6 border-t border-border" />
      <h4 className="nb-ui-label text-foreground">Recent changes</h4>
      <p className="nb-compact mt-1 text-muted-foreground">A record of changes to visibility, interactions, and blocks.</p>
      {recentPrivacyActivity.length === 0 ? <p className="mt-3 nb-compact text-muted-foreground">No recent privacy changes.</p> : <div className="mt-3 divide-y divide-border">{recentPrivacyActivity.map((entry) => <div key={entry.id} className="flex min-h-16 flex-col justify-center gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div><p className="nb-ui-label text-foreground">{entry.label}</p><p className="nb-compact mt-1 text-muted-foreground">{entry.summary}</p></div><time dateTime={entry.createdAt} className="nb-meta shrink-0 text-muted-foreground">{formatDateTime(entry.createdAt)}</time></div>)}</div>}
      <p className="nb-meta mt-4 text-muted-foreground">Activity records use pseudonymous network and device fingerprints and are removed when the account is deleted.</p>
    </SettingsSectionCard>

    <ConfirmDialog
      open={confirmation !== null}
      onOpenChange={(open) => { if (!open) setConfirmation(null); }}
      title={confirmation?.title ?? ""}
      description={confirmation?.description}
      confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
      onConfirm={() => confirmation?.run()}
    />
  </div>;
}
