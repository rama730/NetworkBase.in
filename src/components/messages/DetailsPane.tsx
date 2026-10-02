"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { archiveChannel, leaveChannel } from "@/app/actions/chat/channels";
import { addMembers, removeMember, searchPeople, setMemberState } from "@/app/actions/chat/members";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ConversationContext } from "@/components/messages/conversation-context";
import { MessageRow } from "@/components/messages/MessageRow";
import { useChannelDetails, useChannelMembers } from "@/components/messages/useConversation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { listPins } from "@/app/actions/chat/messages";
import { personName } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatNotify } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

const TABS = ["about", "members", "pins", "settings"] as const;
type Tab = (typeof TABS)[number];

function AddPeople({ channelId, existing }: { channelId: string; existing: Set<string> }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const results = useQuery({
    queryKey: queryKeys.chat.people(query.trim().toLowerCase()),
    enabled: query.trim().length >= 2,
    queryFn: async () => {
      const result = await searchPeople({ query: query.trim() });
      return result.success ? result.people : [];
    },
    staleTime: 60_000,
  });
  const add = async (userId: string) => {
    const result = await addMembers({ channelId, userIds: [userId] });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success("Added");
    setQuery("");
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
  };
  return (
    <div className="space-y-2 border-b border-border p-3">
      <label className="block">
        <span className="sr-only">Add people</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add people by name" className="h-[var(--ui-control-height)] w-full rounded-[5px] border border-input bg-card px-3 text-[15px] pointer-coarse:h-11 pointer-coarse:text-[17px]" />
      </label>
      {(results.data ?? []).filter((p) => !existing.has(p.id)).slice(0, 6).map((person) => (
        <button key={person.id} type="button" onClick={() => void add(person.id)} className="flex min-h-11 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[15px] hover:bg-muted">
          <UserAvatar identity={person} size={24} roundedClassName="rounded-[5px]" />
          <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
          <UserPlus size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** About, Members, Pins, Settings (report 7.10 "Details drawer"). A DM shows the person and its settings. */
export function DetailsPane({ channelId }: { channelId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const details = useChannelDetails(channelId);
  const channel = details.data;
  const members = useChannelMembers(channelId, Boolean(channel?.is_member));
  const initial = params?.get("tab");
  const [confirm, setConfirm] = useState<"leave" | "archive" | null>(null);
  const [tab, setTab] = useState<Tab>(TABS.includes(initial as Tab) ? (initial as Tab) : "about");
  const pins = useQuery({
    queryKey: queryKeys.chat.pins(channelId),
    enabled: tab === "pins",
    queryFn: async () => {
      const result = await listPins({ channelId });
      return result.success ? result.messages : [];
    },
  });
  if (!channel) return <div role="status" aria-label="Loading details" className="flex-1" />;
  const isDm = channel.kind === "dm";
  const isGroup = channel.kind === "private" && channel.name === null;

  const setState = async (patch: { notify?: ChatNotify; starred?: boolean; archived?: boolean }) => {
    const result = await setMemberState({ channelId, ...patch });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    shell.refresh();
    if (patch.archived) router.push("/messages");
  };
  const remove = async (userId: string) => {
    const result = await removeMember({ channelId, userId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channelId) });
  };
  const leaveOrArchive = async (action: "leave" | "archive") => {
    setConfirm(null);
    const result = action === "archive" ? await archiveChannel({ channelId }) : await leaveChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    shell.refresh();
    router.push("/messages");
  };

  const settings = (
    <div className="space-y-4 p-4">
      <fieldset className="space-y-1">
        <legend className="nb-micro mb-1 text-muted-foreground">Notifications</legend>
        {([["all", "All messages"], ["mentions", "Mentions only"], ["mute", "Mute"]] as const).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-[15px] sm:min-h-8">
            <input type="radio" name="chat-notify" checked={channel.notify === value} onChange={() => void setState({ notify: value })} className="accent-[var(--primary)]" />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2 [&>button]:min-h-11 [&>button]:rounded-[5px] [&>button]:border [&>button]:border-border [&>button]:px-3 [&>button]:text-left [&>button]:text-[13px] [&>button]:font-medium sm:[&>button]:min-h-[var(--ui-control-height)]">
        {!isDm ? <button type="button" onClick={() => void setState({ starred: !channel.starred })}>{channel.starred ? "Unstar" : "Star"}</button> : null}
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/messages/${channelId}`); toast.success("Link copied"); }}>Copy link</button>
        {isDm ? <button type="button" onClick={() => void setState({ archived: true })}>Close conversation</button> : null}
        {!isDm && !channel.is_default ? <button type="button" onClick={() => setConfirm("leave")}>Leave</button> : null}
        {channel.can_admin && !isDm && !isGroup && !channel.is_default ? <button type="button" className="text-destructive" onClick={() => setConfirm("archive")}>Archive channel</button> : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "archive" ? "Archive this channel?" : "Leave this conversation?"}
        description={confirm === "archive" ? "Nobody can post in an archived channel. History stays readable." : "You can rejoin a public channel at any time."}
        confirmLabel={confirm === "archive" ? "Archive" : "Leave"}
        variant="destructive"
        onConfirm={() => void leaveOrArchive(confirm ?? "leave")}
      />
    </div>
  );

  if (isDm) {
    const person = channel.dm_user;
    return (
      <div className="app-scroll app-scroll-y min-h-0 flex-1">
        <div className="space-y-2 border-b border-border p-4">
          <UserAvatar identity={person} size={72} roundedClassName="rounded-lg" />
          <p className="text-[17px] font-semibold">{personName(person)}</p>
          {person?.username ? <p className="font-mono text-[12px] text-muted-foreground">@{person.username}</p> : null}
          {person?.username && person.id !== meId ? <Link href={`/u/${person.username}`} className="inline-flex h-[var(--ui-control-height)] items-center rounded-[5px] border border-border px-3 text-[13px] font-medium">View profile</Link> : null}
        </div>
        {settings}
      </div>
    );
  }

  const memberIds = new Set((members.data ?? []).map((m) => m.id));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-3 border-b border-border px-3" role="tablist" aria-label="Details">
        {TABS.map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`nb-tab -mb-px min-h-10 border-b-2 text-[13px] font-medium capitalize ${tab === value ? "border-[var(--chat-accent)]" : "border-transparent text-muted-foreground"}`}>{value}</button>
        ))}
      </div>
      <div className="app-scroll app-scroll-y min-h-0 flex-1">
        {tab === "about" ? (
          <dl className="space-y-4 p-4 text-[15px]">
            <div><dt className="nb-micro text-muted-foreground">Topic</dt><dd>{channel.topic || "No topic"}</dd></div>
            <div><dt className="nb-micro text-muted-foreground">Description</dt><dd>{channel.description || "No description"}</dd></div>
            {channel.project_title ? <div><dt className="nb-micro text-muted-foreground">Project</dt><dd>{channel.project_title}</dd></div> : null}
            <div><dt className="nb-micro text-muted-foreground">Created</dt><dd className="font-mono text-[13px]">{new Date(channel.created_at).toLocaleDateString()}</dd></div>
            {channel.is_default ? <div><dd className="inline-flex rounded-[3px] bg-secondary px-1.5 py-0.5 font-mono text-[11px]">Default channel</dd></div> : null}
          </dl>
        ) : tab === "members" ? (
          <>
            {channel.kind === "private" || channel.can_admin ? <AddPeople channelId={channelId} existing={memberIds} /> : null}
            <ul className="p-2" aria-label="Members">
              {(members.data ?? []).map((member) => (
                <li key={member.id} className="flex min-h-11 items-center gap-2 rounded-[5px] px-2">
                  <UserAvatar identity={member} size={28} roundedClassName="rounded-[5px]" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{personName(member)}{member.id === meId ? " (you)" : ""}</span>
                  {member.role !== "member" ? <span className="font-mono text-[11px] text-muted-foreground">{member.role}</span> : null}
                  {channel.can_admin && member.id !== meId ? (
                    <button type="button" onClick={() => void remove(member.id)} className="nb-icon-button nb-touch-target" aria-label={`Remove ${personName(member)}`}><UserMinus size={16} /></button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : tab === "pins" ? (
          <ConversationContext.Provider value={{
            channelId, meId, canAdmin: channel.can_admin, isDm: false, people: members.data ?? [],
            nameOf: (id) => personName((members.data ?? []).find((m) => m.id === id)), channelNameOf: () => undefined,
            editingSeq: null, setEditingSeq: () => undefined, openThread: (seq) => router.push(`/messages/${channelId}/thread/${seq}`), inThread: false,
          }}>
            {pins.data?.length ? pins.data.map((m) => <MessageRow key={m.seq} message={m} grouped={false} />) : <p className="p-6 text-center text-[13px] text-muted-foreground">{pins.isLoading ? "Loading…" : "Nothing pinned yet."}</p>}
          </ConversationContext.Provider>
        ) : settings}
      </div>
    </div>
  );
}
