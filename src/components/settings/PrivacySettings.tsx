"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, Search, ShieldBan, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { usePrivacySettings } from "@/hooks/useSettingsQueries";
import { invalidatePrivacyDependents } from "@/lib/privacy/client-invalidation";
import type { ConnectionPrivacySetting, MessagePrivacySetting, ProfileVisibilitySetting } from "@/lib/privacy/relationship-state";
import { profileHref } from "@/lib/routing/identifiers";
import type { PrivacyBlockedAccount } from "@/types/settingsTypes";
import { formatCalendarDate, formatDateTime } from "@/lib/ui/date-formatting";
import { cn } from "@/lib/utils";

async function patchPrivacy(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error((typeof json?.error === "string" && json.error) || (typeof json?.message === "string" && json.message) || "Failed to update privacy settings");
  return json?.data;
}

async function fetchBlockedPage(cursor: string) {
  const res = await fetch(`/api/v1/privacy/blocks?cursor=${encodeURIComponent(cursor)}`);
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

function OptionButton({ title, description, icon: Icon, selected, disabled, onClick }: { title: string; description: string; icon?: LucideIcon; selected: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected} className={cn("flex min-h-16 w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60", selected && "border-primary bg-primary/5")}>
    {Icon ? <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", selected && "bg-primary/10 text-primary")}><Icon className="size-4" strokeWidth={1.75} /></span> : null}
    <span className="min-w-0 flex-1"><span className="block nb-ui-label text-foreground">{title}</span><span className="block nb-compact mt-1 text-muted-foreground">{description}</span></span>
  </button>;
}

function BlockedAccountRow({ account, onUnblock, isPending }: { account: PrivacyBlockedAccount; onUnblock: (userId: string) => void; isPending: boolean }) {
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
      <span className="hidden nb-meta text-muted-foreground sm:inline">{account.blockedAt ? `Blocked ${formatCalendarDate(account.blockedAt)}` : "Blocked"}</span>
      <Button type="button" variant="outline" size="sm" onClick={() => onUnblock(account.id)} disabled={isPending}>Unblock</Button>
    </div>
  </div>;
}

function GroupHeading({ title, description }: { title: string; description: string }) {
  return <div><h4 className="nb-ui-label text-foreground">{title}</h4><p className="nb-compact mt-1 text-muted-foreground">{description}</p></div>;
}

export default function PrivacySettings({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = usePrivacySettings();
  const [blockedSearch, setBlockedSearch] = useState("");
  // Pages after the first one; dropped whenever the first page is refetched (unblock, refresh).
  const [more, setMore] = useState<{ base: PrivacyBlockedAccount[] | undefined; accounts: PrivacyBlockedAccount[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const refreshPrivacy = async () => { await invalidatePrivacyDependents(queryClient); };
  const updateMutation = useMutation({
    mutationFn: (update: { url: string; body: Record<string, unknown>; successMessage: string }) => patchPrivacy(update.url, update.body),
    onSuccess: async (_data, update) => { toast.success(update.successMessage); await refreshPrivacy(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update privacy settings"),
  });
  const unblockMutation = useMutation({
    mutationFn: unblockAccount,
    onSuccess: async () => { toast.success("Account unblocked"); await refreshPrivacy(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to unblock account"),
  });

  const settings = data?.settings;
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
      toast.error(error instanceof Error ? error.message : "Failed to load more blocked accounts");
    } finally {
      setLoadingMore(false);
    }
  };
  const filteredBlockedAccounts = blockedAccounts.filter((account) => !blockedQuery || [account.fullName, account.username, account.headline].filter(Boolean).join(" ").toLowerCase().includes(blockedQuery));
  const recentPrivacyActivity = (data?.privacyActivity ?? []).slice(0, 4);
  const change = (url: string, body: Record<string, unknown>, successMessage: string) => updateMutation.mutate({ url, body, successMessage });
  const handleProfileVisibilityChange = (visibility: ProfileVisibilitySetting) => {
    if (visibility === settings?.profileVisibility) return;
    if (visibility === "private" && settings?.profileVisibility !== "private" && typeof window !== "undefined" && !window.confirm("Switch profile visibility to Private? Strangers will only see a locked profile shell.")) return;
    change("/api/v1/privacy", { visibility }, "Profile visibility updated");
  };
  const handleConnectionPrivacyChange = (connectionPrivacy: ConnectionPrivacySetting) => {
    if (connectionPrivacy === settings?.connectionPrivacy) return;
    if (connectionPrivacy === "nobody" && settings?.connectionPrivacy !== "nobody" && typeof window !== "undefined" && !window.confirm("Turn off new connection requests? People will no longer be able to send you new requests.")) return;
    change("/api/v1/privacy", { connectionPrivacy }, "Connection request privacy updated");
  };
  const handleMessagePrivacyChange = (messagePrivacy: MessagePrivacySetting) => {
    if (messagePrivacy !== settings?.messagePrivacy) change("/api/v1/privacy", { messagePrivacy }, "Messaging privacy updated");
  };
  const handleUnblock = (userId: string) => {
    if (typeof window !== "undefined" && !window.confirm("Unblock this account? Future requests and messages will follow your privacy settings.")) return;
    unblockMutation.mutate(userId);
  };

  if (isLoading) return <div className="space-y-4"><div className="h-96 rounded-lg border border-border bg-muted" /><div className="h-48 rounded-lg border border-border bg-muted" /></div>;

  return <div className="space-y-6">
    {!embedded ? <SettingsPageHeader title="Privacy" description="Control profile visibility, interactions, and blocked accounts." /> : null}

    <SettingsSectionCard title="Privacy controls" description="Choose who can view your profile and contact you.">
      <GroupHeading title="Profile visibility" description="Choose who can open your full profile." />
      <div className="mt-3 grid gap-2">
        <OptionButton title="Public" description="Anyone can open your profile." icon={Globe} selected={settings?.profileVisibility === "public"} disabled={updateMutation.isPending || !settings} onClick={() => handleProfileVisibilityChange("public")} />
        <OptionButton title="Connections only" description="Only accepted connections can open your full profile." icon={Users} selected={settings?.profileVisibility === "connections"} disabled={updateMutation.isPending || !settings} onClick={() => handleProfileVisibilityChange("connections")} />
        <OptionButton title="Private" description="Other people see a limited profile shell." icon={Lock} selected={settings?.profileVisibility === "private"} disabled={updateMutation.isPending || !settings} onClick={() => handleProfileVisibilityChange("private")} />
      </div>

      <div className="my-6 border-t border-border" />
      <GroupHeading title="Messages" description="Choose who can start a direct conversation with you." />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <OptionButton title="Connections only" description="Only accepted connections." selected={settings?.messagePrivacy === "connections"} disabled={updateMutation.isPending || !settings} onClick={() => handleMessagePrivacyChange("connections")} />
        <OptionButton title="Everyone" description="Anyone who is not blocked." selected={settings?.messagePrivacy === "everyone"} disabled={updateMutation.isPending || !settings} onClick={() => handleMessagePrivacyChange("everyone")} />
      </div>

      <div className="my-6 border-t border-border" />
      <GroupHeading title="Connection requests" description="Choose who can send you a connection request." />
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <OptionButton title="Everyone" description="Any eligible account." selected={settings?.connectionPrivacy === "everyone"} disabled={updateMutation.isPending || !settings} onClick={() => handleConnectionPrivacyChange("everyone")} />
        <OptionButton title="Mutual connections" description="People who share a connection." selected={settings?.connectionPrivacy === "mutuals_only"} disabled={updateMutation.isPending || !settings} onClick={() => handleConnectionPrivacyChange("mutuals_only")} />
        <OptionButton title="Nobody" description="Do not accept new requests." selected={settings?.connectionPrivacy === "nobody"} disabled={updateMutation.isPending || !settings} onClick={() => handleConnectionPrivacyChange("nobody")} />
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard title="Blocked accounts and activity" description="Manage blocked people and review recent privacy changes.">
      {data && data.blockedAccounts.length > 0 ? <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} /><input type="search" value={blockedSearch} onChange={(event) => setBlockedSearch(event.target.value)} placeholder="Search blocked accounts" className="h-10 w-full rounded-md border border-border bg-background pl-10 pr-3 nb-compact text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div> : null}
      {!data || data.blockedAccounts.length === 0 ? <div className="flex min-h-24 items-center gap-3 rounded-md border border-dashed border-border bg-card nb-grid-ground px-4"><ShieldBan className="size-5 text-muted-foreground" strokeWidth={1.75} /><div><p className="nb-ui-label text-foreground">No blocked accounts</p><p className="nb-compact mt-1 text-muted-foreground">Blocked people will appear here.</p></div></div> : filteredBlockedAccounts.length === 0 ? <p className="py-6 text-center nb-compact text-muted-foreground">No blocked accounts match your search.</p> : <div>{filteredBlockedAccounts.map((account) => <BlockedAccountRow key={account.id} account={account} isPending={unblockMutation.isPending && unblockMutation.variables === account.id} onUnblock={handleUnblock} />)}</div>}
      {nextBlockedCursor ? <div className="mt-3 flex justify-center"><Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={loadMoreBlocked}>{loadingMore ? "Loading…" : "Load more"}</Button></div> : null}

      <div className="my-6 border-t border-border" />
      <GroupHeading title="Recent changes" description="A record of changes to visibility, interactions, and blocks." />
      {recentPrivacyActivity.length === 0 ? <p className="mt-3 nb-compact text-muted-foreground">No recent privacy changes.</p> : <div className="mt-3 divide-y divide-border">{recentPrivacyActivity.map((entry) => <div key={entry.id} className="flex min-h-16 flex-col justify-center gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div><p className="nb-ui-label text-foreground">{entry.label}</p><p className="nb-compact mt-1 text-muted-foreground">{entry.summary}</p></div><time className="nb-meta shrink-0 text-muted-foreground">{formatDateTime(entry.createdAt)}</time></div>)}</div>}
      <p className="nb-meta mt-4 text-muted-foreground">Activity records use pseudonymous network and device fingerprints and are removed when the account is deleted.</p>
    </SettingsSectionCard>
  </div>;
}
