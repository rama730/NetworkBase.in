"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast, feedbackError } from "@/lib/feedback";
import { PixelIcon } from "@/components/auth/pixel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SearchField } from "@/components/ui/SearchField";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { LogList, SegChoice, Tag } from "@/components/settings/mix/parts";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { setShowActivity } from "@/app/actions/presence";
import { useMyPresenceSettings, useRefreshPresence } from "@/components/presence/useMyPresence";
import { profileEditHref } from "@/lib/profile/edit-route";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { usePrivacySettings } from "@/hooks/useSettingsQueries";
import { useAuth } from "@/hooks/use-auth";
import { invalidatePrivacyDependents } from "@/lib/privacy/client-invalidation";
import type { ConnectionPrivacySetting, MessagePrivacySetting, ProfileVisibilitySetting } from "@/lib/privacy/relationship-state";
import { profileHref } from "@/lib/routing/identifiers";
import type { PrivacyBlockedAccount } from "@/types/settingsTypes";
import { logDate } from "@/lib/settings/format";
import { padCount } from "@/lib/ui/tab-marker";
import { announceRelationshipChange, useMuteToggle } from "@/components/privacy/BlockDialog";
import { queryKeys } from "@/lib/query-keys";

// "Who can…" (settings mix v2): each question is one row of segmented cells, the chosen option's line beneath.
const PROFILE_CHOICES: Record<ProfileVisibilitySetting, { label: string; line: string }> = {
  public: { label: "Anyone", line: "Anyone can open your profile. You show up in Discover and search." },
  connections: { label: "Connections", line: "Only people you’re connected with see your full profile." },
  private: { label: "Only me", line: "Others see a locked profile. You’re hidden from Discover." },
};
const MESSAGE_CHOICES: Record<MessagePrivacySetting, { label: string; line: string }> = {
  connections: { label: "Connections", line: "Only people you’re connected with can start a conversation." },
  everyone: { label: "Everyone", line: "Anyone who isn’t blocked. Invitations and applications still reach you either way." },
};
const REQUEST_CHOICES: Record<ConnectionPrivacySetting, { label: string; line: string }> = {
  everyone: { label: "Everyone", line: "Any account can ask to connect." },
  mutuals_only: { label: "Mutual", line: "Only people you share a connection with." },
  nobody: { label: "Nobody", line: "No new requests. Your connections stay." },
};
const options = <T extends string>(choices: Record<T, { label: string }>) => (Object.keys(choices) as T[]).map((value) => ({ value, label: choices[value].label }));

async function patchPrivacy(body: Record<string, unknown>) {
  const res = await fetch("/api/v1/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error((typeof json?.error === "string" && json.error) || (typeof json?.message === "string" && json.message) || "Couldn’t update privacy settings");
  return json?.data;
}

async function fetchBlockedPage(cursor: string) {
  const res = await fetch(`/api/v1/privacy/blocks?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error("Couldn’t load more blocked accounts");
  return json.data as { accounts: PrivacyBlockedAccount[]; nextCursor: string | null };
}

async function unblockAccount(userId: string) {
  const res = await fetch(`/api/v1/privacy/blocks/${userId}`, { method: "DELETE" });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error((typeof json?.error === "string" && json.error) || (typeof json?.message === "string" && json.message) || "Couldn’t unblock account");
  return json?.data;
}

const BLOCK_SOURCE_LABEL: Record<string, string> = { profile: "from their profile", message: "from Messages", comment: "from a comment", person_card: "from a person card", member_list: "from a member list", report: "with a report", settings: "from Settings" };

function BlockedAccountRow({ account, onUnblock, isPending }: { account: PrivacyBlockedAccount; onUnblock: (account: PrivacyBlockedAccount) => void; isPending: boolean }) {
  const displayName = account.fullName || account.username || "Unknown user";
  const [note, setNote] = useState(account.note ?? "");
  // Your private note on the block, seen only by you (B30). Saved when you leave the field.
  const saveNote = async () => {
    if (note.trim() === (account.note ?? "")) return;
    const { setBlockNoteAction } = await import("@/app/actions/blocking");
    const result = await setBlockNoteAction(account.id, note);
    if (!result.success) toast.error(result.error);
  };
  const source = account.source ? BLOCK_SOURCE_LABEL[account.source] : null;
  return (
    <SecurityListRow
      tile={<span className="px"><UserAvatar identity={account} className="size-full" roundedClassName="rounded-none" sizes="34px" fallbackDisplayName={displayName} /></span>}
      title={<Link href={profileHref(account)} className="hover:underline">{displayName}</Link>}
      details={[account.username ? `@${account.username}` : null, account.blockedAt ? `blocked ${logDate(account.blockedAt)}` : "blocked", source].filter(Boolean).join(" · ")}
      action={<Button type="button" variant="outline" size="sm" aria-label={`Unblock ${displayName}`} onClick={() => onUnblock(account)} pending={isPending} disabled={isPending}>Unblock</Button>}
    >
      <input className="note w-full" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} onBlur={() => void saveNote()} placeholder="Private note (only you see this)" aria-label={`Private note about ${displayName}`} />
    </SecurityListRow>
  );
}

function BlockByHandle({ onBlocked }: { onBlocked: () => Promise<void> }) {
  const [handle, setHandle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Block someone without opening their profile (B25), with the same Undo as everywhere else (B12).
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!handle.trim() || pending) return;
    setPending(true); setError(null);
    const { blockByHandleAction, undoBlockAction } = await import("@/app/actions/blocking");
    const result = await blockByHandleAction(handle);
    setPending(false);
    if (!result.success) return setError(result.error);
    setHandle("");
    announceRelationshipChange(result.id);
    await onBlocked();
    toast(`${result.name} blocked`, { duration: result.undoSeconds * 1000, action: { label: "Undo", onClick: async () => {
      const undo = await undoBlockAction(result.id);
      toast(undo.success ? `${result.name} unblocked` : undo.error);
      if (undo.success) { announceRelationshipChange(result.id); await onBlocked(); }
    } } });
  };
  return <form onSubmit={submit} className="nbs-pad">
    <div className="flex max-w-[480px] gap-2">
      <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@handle" aria-label="Block someone by @handle" autoComplete="off" className="h-[var(--ui-control-height)] min-w-0 flex-1 rounded-[5px] border border-border bg-card px-2.5 font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none" />
      <Button type="submit" variant="outline" pending={pending} disabled={pending || !handle.trim()}>Block</Button>
    </div>
    {error ? <p role="alert" className="mt-1.5 nb-meta text-destructive">{error}</p> : null}
  </form>;
}

function MutedPeople() {
  const toggleMute = useMuteToggle();
  const muted = useQuery({
    queryKey: [...queryKeys.settings.privacy(), "muted"],
    queryFn: async () => {
      const { listMutedAction } = await import("@/app/actions/blocking");
      const result = await listMutedAction();
      if (!result.success) throw new Error(result.error);
      return result.people ?? [];
    },
  });
  // Mute (Blocking B26): lighter than a block. Their posts, comments and messages fold for you; they aren't told.
  return <SettingsSectionCard id="settings-privacy-muted" title="Muted people" state={muted.data?.length ? padCount(muted.data.length) : undefined} stateOk flush findKeys="mute">
    {muted.isError ? <div className="nbs-body"><ErrorNotice what="Muted people" onRetry={() => void muted.refetch()} /></div> : null}
    {muted.data && muted.data.length === 0 ? <EmptyState compact figure="person" className="nbs-empty" title="No one muted" description="Mute someone from their profile’s ⋯ menu. Their posts fold away in spaces you share; nothing else changes." /> : null}
    {muted.data?.length ? <div className="nbs-list">{muted.data.map((person) => (
      <SecurityListRow key={person.id}
        tile={<span className="px"><UserAvatar identity={person} className="size-full" roundedClassName="rounded-none" sizes="34px" fallbackDisplayName={person.name} /></span>}
        title={person.name} details={person.username ? `@${person.username}` : undefined}
        action={<Button type="button" variant="outline" size="sm" onClick={() => toggleMute({ id: person.id, name: person.name }, false)}>Unmute</Button>} />
    ))}</div> : null}
  </SettingsSectionCard>;
}

/** What someone who isn't connected to you sees, live as the profile choice changes. */
function StrangerPreview({ visibility }: { visibility: ProfileVisibilitySetting }) {
  const { profile } = useAuth();
  const name = profile?.fullName || profile?.username || "You";
  const handle = profile?.username ? `@${profile.username}` : "";
  const picture = <span className="px">{profile ? <UserAvatar identity={profile} className="size-full" roundedClassName="rounded-none" sizes="40px" fallbackDisplayName={name} /> : null}</span>;
  if (visibility === "private") {
    return <div className="nbs-pv-card"><div className="nbs-pv-lock"><PixelIcon name="lock" size={24} /><b className="font-semibold text-foreground">This profile is private</b><span>{handle}</span><Button type="button" variant="outline" size="sm" tabIndex={-1} aria-hidden="true">Connect</Button></div></div>;
  }
  const full = visibility === "public";
  return (
    <div className="nbs-pv-card">
      <div className="nbs-pv-band">{picture}<div className="min-w-0"><b>{name}</b><span>{handle}{full && profile?.headline ? ` · ${profile.headline}` : ""}</span></div></div>
      <div className="nbs-pv-body">
        {full ? <>
          <span>{profile?.bio ? profile.bio.slice(0, 90) : "Your bio, workspaces and contributions."}</span>
          <span className="bar" style={{ width: "90%" }} /><span className="bar" style={{ width: "70%" }} />
        </> : <>
          <span>Connect with {name.split(" ")[0]} to see the profile, workspaces and contributions.</span>
          <Button type="button" variant="outline" size="sm" tabIndex={-1} aria-hidden="true" className="justify-self-start">Connect</Button>
        </>}
      </div>
    </div>
  );
}

type Confirmation = { title: string; description: string; confirmLabel: string; run: () => void };
type Field = "visibility" | "messagePrivacy" | "connectionPrivacy";

export default function PrivacySettings() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { data, isLoading, isError, refetch } = usePrivacySettings();
  const [blockedSearch, setBlockedSearch] = useState("");
  // Pages after the first one; dropped whenever the first page is refetched (unblock, refresh).
  const [more, setMore] = useState<{ base: PrivacyBlockedAccount[] | undefined; accounts: PrivacyBlockedAccount[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // A choice that didn't save: shown beside its row with Try again (no toast; settings mix feedback).
  const [failed, setFailed] = useState<{ field: Field; value: string; message: string } | null>(null);
  const refreshPrivacy = async () => { await invalidatePrivacyDependents(queryClient); };
  const updateMutation = useMutation({
    mutationFn: (update: { field: Field; value: string }) => patchPrivacy({ [update.field]: update.value }),
    onMutate: async (update) => {
      setFailed(null);
      await queryClient.cancelQueries({ queryKey: queryKeys.settings.privacy() });
      const previous = queryClient.getQueryData(queryKeys.settings.privacy());
      const key = update.field === "visibility" ? "profileVisibility" : update.field;
      queryClient.setQueryData(queryKeys.settings.privacy(), (current: typeof data) => current ? { ...current, settings: { ...current.settings, [key]: update.value } } : current);
      return { previous };
    },
    onSuccess: async () => { await refreshPrivacy(); },
    onError: (error, update, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.settings.privacy(), context.previous);
      setFailed({ ...update, message: feedbackError(error instanceof Error ? error.message : "", "Couldn’t save") });
    },
  });
  const presence = useMyPresenceSettings();
  const refreshPresence = useRefreshPresence();
  const activityMutation = useMutation({
    mutationFn: async (show: boolean) => {
      const result = await setShowActivity({ show });
      if (!result.success) throw new Error("Couldn’t update activity visibility");
    },
    onSuccess: async () => { await refreshPresence(); },
  });
  const unblockMutation = useMutation({
    mutationFn: unblockAccount,
    onSuccess: async (_data, userId) => {
      setMore(null);
      announceRelationshipChange(userId);
      await refreshPrivacy();
      toast("Account unblocked", { duration: 10_000, action: { label: "Undo", onClick: async () => {
        const { blockPersonAction } = await import("@/app/actions/blocking");
        const again = await blockPersonAction(userId, "settings");
        toast(again.success ? "Blocked again" : again.error);
        if (again.success) { announceRelationshipChange(userId); await refreshPrivacy(); }
      } } });
    },
    onError: (error) => toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t unblock account", "Couldn’t unblock account")),
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
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t load more blocked accounts", "Couldn’t load more blocked accounts"));
    } finally {
      setLoadingMore(false);
    }
  };
  const filteredBlockedAccounts = blockedAccounts.filter((account) => !blockedQuery || [account.fullName, account.username, account.headline].filter(Boolean).join(" ").toLowerCase().includes(blockedQuery));
  const change = (field: Field, value: string) => updateMutation.mutate({ field, value });
  const pickVisibility = (visibility: ProfileVisibilitySetting) => {
    if (visibility === "private") {
      setConfirmation({ title: "Make your profile private?", description: "Strangers see only a locked profile, and you’re hidden from Discover.", confirmLabel: "Make private", run: () => change("visibility", visibility) });
      return;
    }
    change("visibility", visibility);
  };
  const pickRequests = (connectionPrivacy: ConnectionPrivacySetting) => {
    if (connectionPrivacy === "nobody") {
      setConfirmation({ title: "Stop new connection requests?", description: "No one can send you a new request. Your connections stay.", confirmLabel: "Stop requests", run: () => change("connectionPrivacy", connectionPrivacy) });
      return;
    }
    change("connectionPrivacy", connectionPrivacy);
  };
  const handleUnblock = (account: PrivacyBlockedAccount) => {
    const name = account.fullName || account.username || "this account";
    setConfirmation({ title: `Unblock ${name}?`, description: "They’ll be able to find you, message you if your settings allow, and see your public posts again. They won’t be told. Your connection won’t come back; either of you can send a new request.", confirmLabel: "Unblock", run: () => unblockMutation.mutate(account.id) });
  };
  const retry = (field: Field) => failed?.field === field ? (
    <span role="alert" className="nb-retry"><b>Not saved</b><span className="sr-only">: {failed.message}</span><button type="button" title={failed.message} onClick={() => change(field, failed.value)}>Try again</button></span>
  ) : null;

  if (isLoading) return <SettingsSectionsSkeleton count={3} />;
  // Without the data there is nothing true to show: not "no blocked accounts", and no options that look unset.
  if (isError || !data) return <div className="nbs-body pt-4"><ErrorNotice what="Privacy settings" onRetry={() => void refetch()} /></div>;

  const visibility = (settings?.profileVisibility ?? "public") as ProfileVisibilitySetting;
  const messages = (settings?.messagePrivacy ?? "connections") as MessagePrivacySetting;
  const requests = (settings?.connectionPrivacy ?? "everyone") as ConnectionPrivacySetting;
  const blockedCount = data.blockedAccounts.length;

  return <>
    <SettingsSectionCard id="settings-privacy-reach" title="Who can…" flush findKeys="visibility profile messages requests">
      <div className="nbs-reach">
        <div className="nbs-reach-rows">
          <SettingsRow id="settings-privacy-visibility" findKeys="public private profile" title="See your full profile" description={PROFILE_CHOICES[visibility].line}
            right={<>{retry("visibility")}<SegChoice label="Who can see your full profile" value={visibility} options={options(PROFILE_CHOICES)} onChange={pickVisibility} busy={busy} /></>} />
          <SettingsRow id="settings-privacy-messages" findKeys="dm direct messages" title="Start a conversation" description={MESSAGE_CHOICES[messages].line}
            right={<>{retry("messagePrivacy")}<SegChoice label="Who can start a conversation" value={messages} options={options(MESSAGE_CHOICES)} onChange={(value) => change("messagePrivacy", value)} busy={busy} /></>} />
          <SettingsRow id="settings-privacy-requests" findKeys="connection requests connect" title="Send you a connection request" description={REQUEST_CHOICES[requests].line}
            right={<>{retry("connectionPrivacy")}<SegChoice label="Who can send you a connection request" value={requests} options={options(REQUEST_CHOICES)} onChange={pickRequests} busy={busy} /></>} />
        </div>
        <div className="nbs-preview" aria-live="polite">
          <p className="nbs-eyebrow">What a stranger sees</p>
          <StrangerPreview visibility={visibility} />
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-privacy-activity" title="Activity and discovery" flush>
      <SettingsRows>
        <SettingsRow
          title="Show when I’m active"
          description="Others see a dot when you’re online, and when you were last active. Off hides both."
          right={<SettingsSwitch aria-label="Show when I’m active" checked={presence.data?.showActivity ?? true} disabled={!presence.data} onCheckedChange={(show) => activityMutation.mutateAsync(show)} />}
        />
        <SettingsRow title="Status visibility" description="You choose who sees each status when you set it, from your picture menu." right={<span className="v text-muted-foreground">Per status</span>} />
        <SettingsRow
          title="Open to collaborate"
          description="Shows the label on your profile and in people suggestions."
          right={<>{profile ? <Tag tone={profile.openToCollaborate ? "ok" : undefined} tick={Boolean(profile.openToCollaborate)}>{profile.openToCollaborate ? "On" : "Off"}</Tag> : null}<Button asChild variant="outline" size="sm"><Link href={profileEditHref("opportunity")}>Edit</Link></Button></>}
        />
      </SettingsRows>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-privacy-blocked" title="Blocked people" state={blockedCount ? padCount(blockedCount) + (data.blockedAccountsNextCursor ? "+" : "") : undefined} stateOk flush findKeys="block unblock">
      <BlockByHandle onBlocked={async () => { setMore(null); await refreshPrivacy(); }} />
      {blockedAccounts.length > 5 ? <div className="nbs-pad"><SearchField label="Search blocked people" value={blockedSearch} onChange={setBlockedSearch} /></div> : null}
      {blockedCount === 0 ? <EmptyState compact figure="person" className="nbs-empty" title="No one blocked" description="Block someone from their profile, a message or above by @handle." />
        : filteredBlockedAccounts.length === 0 ? <p className="nbs-ghelp">No blocked people match “{blockedSearch.trim()}”.</p>
        : <div className="nbs-list">{filteredBlockedAccounts.map((account) => <BlockedAccountRow key={account.id} account={account} isPending={unblockMutation.isPending && unblockMutation.variables === account.id} onUnblock={handleUnblock} />)}</div>}
      {blockedQuery && nextBlockedCursor ? <p className="nbs-ghelp">Search covers the people loaded so far.</p> : null}
      {nextBlockedCursor ? <div className="nbs-more"><Button pending={loadingMore} pendingLabel="Loading" type="button" variant="ghost" size="sm" disabled={loadingMore} onClick={loadMoreBlocked}>Load more</Button></div> : null}
      <p className="nbs-foot">They can’t find you, message you, mention you or see your posts, and you won’t see theirs. They aren’t told.</p>
    </SettingsSectionCard>

    <MutedPeople />

    <SettingsSectionCard id="settings-privacy-history" title="Recent changes" flush findKeys="privacy history log">
      <LogList
        label="Recent privacy changes"
        empty={<p className="nbs-ghelp">No privacy changes yet.</p>}
        entries={(data.privacyActivity ?? []).map((entry) => ({ key: entry.id, date: logDate(entry.createdAt), dateTime: entry.createdAt, event: entry.label, detail: entry.summary }))}
      />
      <p className="nbs-foot">Network and device are short codes, not your address or device name. Removed when the account is deleted.</p>
    </SettingsSectionCard>

    <ConfirmDialog
      open={confirmation !== null}
      onOpenChange={(open) => { if (!open) setConfirmation(null); }}
      title={confirmation?.title ?? ""}
      description={confirmation?.description}
      confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
      onConfirm={() => confirmation?.run()}
    />
  </>;
}
