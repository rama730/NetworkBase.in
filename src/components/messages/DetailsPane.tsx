"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Copy, Files, MessageSquare, MoreHorizontal, Pin, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { archiveChannel, leaveChannel, renameGroup, updateChannel, type ChannelDetails } from "@/app/actions/chat/channels";
import { getOrCreateDm, getPersonContext, removeMember, setMemberRole, setMemberState } from "@/app/actions/chat/members";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { AddPeople } from "@/components/messages/parts/AddPeople";
import { useChannelDetails, useChannelMembers } from "@/components/messages/useConversation";
import { PresenceAvatar } from "@/components/presence/PersonPresence";
import { PresenceBadge } from "@/components/presence/PresenceBadge";
import { StatusInline } from "@/components/presence/StatusInline";
import { usePersonPresence } from "@/components/presence/usePresence";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/hooks/useOnlineUsers";
import type { ChannelMember } from "@/app/actions/chat/channels";
import { personName } from "@/lib/messaging/channel-view";
import { CHAT_CHANNEL_NAME_PATTERN, CHAT_MAX_DESCRIPTION } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref, type DetailsTab } from "@/lib/messaging/routes";
import type { ChatNotify } from "@/lib/messaging/types";
import { profileHref } from "@/lib/routing/identifiers";
import { queryKeys } from "@/lib/query-keys";

type Field = "name" | "topic" | "description" | "title";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin" };

/** A row of About that edits in place: click it, type, Enter (or blur) saves, Esc cancels. */
function EditableRow({ label, value, placeholder, editable, multiline, prefix, onSave, transform, valid = () => true, hint }: {
  label: string; value: string | null; placeholder: string; editable: boolean; multiline?: boolean; prefix?: string;
  onSave: (next: string) => Promise<boolean>; transform?: (raw: string) => string; valid?: (next: string) => boolean; hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const saving = useRef(false);
  const cancelled = useRef(false);
  const start = () => { cancelled.current = false; setDraft(value ?? ""); };
  const save = async () => {
    if (draft === null || saving.current || cancelled.current) return;
    const next = draft.trim();
    if (next === (value ?? "") || !valid(next)) return setDraft(null);
    saving.current = true;
    const ok = await onSave(next);
    saving.current = false;
    if (ok) setDraft(null);
  };
  const Input = multiline ? "textarea" : "input";
  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-foreground">{label}</span>
        {editable && draft === null ? <button type="button" onClick={start} className="text-[12px] font-medium text-primary hover:underline">Edit</button> : null}
      </div>
      {draft !== null ? (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-start rounded-[5px] border border-input bg-card px-2 focus-within:ring-1 focus-within:ring-ring">
            {prefix ? <span className="select-none py-1.5 font-mono text-[14px] text-muted-foreground">{prefix}</span> : null}
            <Input
              autoFocus
              aria-label={label}
              value={draft}
              rows={multiline ? 3 : undefined}
              onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(transform ? transform(e.target.value) : e.target.value)}
              onBlur={() => void save()}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelled.current = true; setDraft(null); }
                if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
              }}
              className="w-full resize-none bg-transparent py-1.5 text-[14px] outline-none"
            />
          </div>
          {hint || !valid(draft.trim()) ? <p className={`text-[12px] ${valid(draft.trim()) ? "text-muted-foreground" : "text-destructive"}`}>{hint}</p> : null}
        </div>
      ) : (
        <button
          type="button"
          disabled={!editable}
          onClick={start}
          className={`mt-1 block w-full whitespace-pre-wrap text-left text-[13px] leading-relaxed ${value ? "text-foreground" : "text-muted-foreground"} ${editable ? "cursor-text rounded-[4px] hover:bg-muted/60" : "cursor-default"}`}
        >
          {value ? `${prefix ?? ""}${value}` : editable ? placeholder : "None"}
        </button>
      )}
    </div>
  );
}

function NotifyRow({ channel, onChange }: { channel: ChannelDetails; onChange: (notify: ChatNotify) => void }) {
  return (
    <label className="flex items-center gap-3 p-4">
      <Bell size={15} aria-hidden="true" className="text-muted-foreground" />
      <span className="flex-1 text-[13px] font-semibold">Notifications</span>
      <select value={channel.notify} onChange={(e) => onChange(e.target.value as ChatNotify)} className="h-8 rounded-[5px] border border-input bg-card px-2 text-[13px]">
        <option value="all">All messages</option>
        <option value="mentions">Mentions only</option>
        <option value="mute">Muted</option>
      </select>
    </label>
  );
}

function ConversationShortcuts({ channelId }: { channelId: string }) {
  const item = "flex min-h-10 items-center gap-2.5 rounded-[5px] px-3 text-[13px] font-medium hover:bg-muted";
  return (
    <div className="grid grid-cols-3 gap-1 p-2">
      <Link href={`${conversationHref(channelId)}?tab=pins`} className={item}><Pin size={14} aria-hidden="true" /> Pins</Link>
      <Link href={`${conversationHref(channelId)}?tab=files`} className={item}><Files size={14} aria-hidden="true" /> Files</Link>
      <Link href={`/messages/search?in=${channelId}`} className={item}><Search size={14} aria-hidden="true" /> Search</Link>
    </div>
  );
}

function MemberRow({ member, channel, meId, online, onRemove }: { member: ChannelMember; channel: ChannelDetails; meId: string | null; online?: boolean; onRemove: (member: ChannelMember) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const presence = usePersonPresence(member.id, { live: online });
  const self = member.id === meId;
  const message = async () => {
    const result = await getOrCreateDm({ userId: member.id });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    router.push(conversationHref(result.channelId));
  };
  const role = async (next: "admin" | "member") => {
    const result = await setMemberRole({ channelId: channel.id, userId: member.id, role: next });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channel.id) });
    toast.success(`${personName(member)} is now ${next === "admin" ? "an admin" : "a member"}`);
  };
  const canManage = channel.can_admin && !self && member.role !== "owner" && channel.kind !== "dm";
  return (
    <li className="group/member flex min-h-12 items-center gap-2.5 rounded-[5px] px-2 hover:bg-muted/50">
      <PresenceAvatar userId={member.id} live={online} identity={member} size={30} roundedClassName="rounded-[5px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium">{personName(member)}{self ? " (you)" : ""}</span>
          {presence.status?.emoji ? <span className="flex-none font-[system-ui] text-[13px]" title={presence.statusText ?? undefined}>{presence.status.emoji}</span> : null}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">{presence.statusText || presence.availabilityText}</span>
      </span>
      {ROLE_LABEL[member.role] ? <span className="flex-none rounded-[3px] bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{ROLE_LABEL[member.role]}</span> : null}
      {!self ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="grid size-8 flex-none place-items-center rounded-[5px] pointer-coarse:size-11 text-muted-foreground hover:bg-muted hover:text-foreground pointer-fine:opacity-0 pointer-fine:group-hover/member:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100" aria-label={`Options for ${personName(member)}`}>
            <MoreHorizontal size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => void message()}><MessageSquare size={14} className="mr-2" /> Message</DropdownMenuItem>
            {member.username ? <DropdownMenuItem asChild><Link href={profileHref({ id: member.id, username: member.username })}>View profile</Link></DropdownMenuItem> : null}
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                {member.role === "admin"
                  ? <DropdownMenuItem onSelect={() => void role("member")}>Remove as admin</DropdownMenuItem>
                  : <DropdownMenuItem onSelect={() => void role("admin")}>Make admin</DropdownMenuItem>}
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onRemove(member)}>Remove from channel</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function Members({ channel, meId }: { channel: ChannelDetails; meId: string | null }) {
  const queryClient = useQueryClient();
  const members = useChannelMembers(channel.id, channel.is_member);
  const [filter, setFilter] = useState("");
  const [removing, setRemoving] = useState<ChannelMember | null>(null);
  const ids = useMemo(() => (members.data ?? []).slice(0, 50).map((m) => m.id), [members.data]);
  const online = useOnlineUsers(ids);
  // You first, then admins, then who's active, then A–Z.
  const rank = (m: ChannelMember) => (m.id === meId ? 0 : m.role !== "member" ? 1 : online[m.id] ? 2 : 3);
  const list = (members.data ?? [])
    .filter((m) => !filter || personName(m).toLowerCase().includes(filter.toLowerCase()) || (m.username ?? "").toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || personName(a).localeCompare(personName(b)));
  const remove = async () => {
    const member = removing;
    setRemoving(null);
    if (!member) return;
    const result = await removeMember({ channelId: channel.id, userId: member.id });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channel.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channel.id) });
    toast.success(`${personName(member)} was removed`);
  };
  const canAdd = channel.kind === "private" || channel.can_admin || channel.kind === "public";
  return (
    <div className="space-y-2 p-3">
      {canAdd ? <AddPeople channelId={channel.id} /> : null}
      <label className="block">
        <span className="sr-only">Find members</span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Find among ${channel.member_count} members`} className="h-9 w-full rounded-[5px] border border-input bg-background px-3 text-[14px]" />
      </label>
      {members.isLoading ? <p className="p-4 text-center text-[13px] text-muted-foreground">Loading members…</p> : null}
      <ul aria-label="Members" className="space-y-px">
        {list.map((member) => <MemberRow key={member.id} member={member} channel={channel} meId={meId} online={online[member.id]} onRemove={setRemoving} />)}
      </ul>
      {members.data && !list.length ? <p className="p-4 text-center text-[13px] text-muted-foreground">No members match.</p> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? personName(removing) : ""}?`}
        description={channel.kind === "public" ? "They can rejoin this public channel later." : "They'll need to be added again to come back."}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/** A DM's details: who they are, how they're doing, what you share. */
function PersonDetails({ channel, meId, setState, onClose }: { channel: ChannelDetails; meId: string | null; setState: (patch: { notify?: ChatNotify }) => void; onClose: () => void }) {
  const person = channel.dm_user;
  const self = person?.id === meId;
  const presence = usePersonPresence(person?.id);
  const context = useQuery({
    queryKey: ["chat-v3", "person-context", person?.id ?? ""],
    enabled: Boolean(person && !self),
    queryFn: async () => {
      const result = await getPersonContext({ userId: person!.id });
      return result.success ? result.context : null;
    },
    staleTime: 5 * 60_000,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const tz = context.data?.timeZone;
  const localTime = tz ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }) : null;
  return (
    <div className="app-scroll app-scroll-y min-h-0 flex-1">
      <div className="space-y-2 border-b border-border p-4">
        <PresenceAvatar userId={person?.id} identity={person} size={72} roundedClassName="rounded-lg" />
        <p className="text-[18px] font-semibold">{self ? "You" : personName(person)}</p>
        {person?.username ? <p className="font-mono text-[12px] text-muted-foreground">@{person.username}</p> : null}
        {presence.status ? <StatusInline emoji={presence.status.emoji} text={presence.statusText} className="text-[14px]" /> : null}
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <PresenceBadge availability={presence.availability} size={10} />
          {presence.availabilityText}
          {localTime ? <span>· {localTime} local time</span> : null}
        </p>
        {person?.username && !self ? (
          <Link href={profileHref({ id: person.id, username: person.username })} className="inline-flex h-[var(--ui-control-height)] items-center rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted">View profile</Link>
        ) : null}
      </div>
      <ConversationShortcuts channelId={channel.id} />
      {context.data && (context.data.sharedProjects.length || context.data.sharedChannels.length) ? (
        <div className="space-y-3 border-t border-border p-4">
          {context.data.sharedProjects.length ? (
            <div>
              <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Projects in common</p>
              {context.data.sharedProjects.map((p) => <Link key={p.id} href={`/projects/${p.slug ?? p.id}`} className="block truncate py-0.5 text-[13px] text-primary hover:underline">{p.title}</Link>)}
            </div>
          ) : null}
          {context.data.sharedChannels.length ? (
            <div>
              <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Channels in common</p>
              {context.data.sharedChannels.map((c) => (
                <Link key={c.id} href={conversationHref(c.id)} className="block truncate py-0.5 text-[13px] hover:underline">#{c.name}{c.project_title ? <span className="text-muted-foreground"> · {c.project_title}</span> : null}</Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="border-t border-border">
        <NotifyRow channel={channel} onChange={(notify) => setState({ notify })} />
      </div>
      <div className="border-t border-border p-4">
        <button type="button" onClick={onClose} className="h-9 rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted">Close conversation</button>
      </div>
    </div>
  );
}

/** About and Members (Slack's details). Pins, files and settings live in the conversation itself. */
export function DetailsPane({ channelId, tab, onTab }: { channelId: string; tab: DetailsTab; onTab: (tab: DetailsTab) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const details = useChannelDetails(channelId);
  const channel = details.data as ChannelDetails | undefined;
  const members = useChannelMembers(channelId, Boolean(channel?.is_member));
  const [confirm, setConfirm] = useState<"leave" | "archive" | null>(null);

  if (!channel) return <div role="status" aria-label="Loading details" className="flex-1" />;
  const isDm = channel.kind === "dm";
  const isGroup = channel.kind === "private" && channel.name === null;

  const refreshChannel = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    shell.refresh();
  };
  const setState = async (patch: { notify?: ChatNotify; archived?: boolean }) => {
    const result = await setMemberState({ channelId, ...patch });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshChannel();
    if (patch.archived) {
      router.push("/messages");
      toast("Conversation closed", { action: { label: "Undo", onClick: () => void setMemberState({ channelId, archived: false }).then(() => shell.refresh()) } });
    }
  };
  const saveField = (field: Field) => async (value: string) => {
    const result = field === "title"
      ? await renameGroup({ channelId, title: value || null })
      : await updateChannel({ channelId, [field]: field === "name" ? value : value || "" });
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      return false;
    }
    toast.success(field === "name" ? `Renamed to #${value}` : field === "title" ? "Group renamed" : `${field[0]!.toUpperCase()}${field.slice(1)} updated`);
    refreshChannel();
    return true;
  };
  const leaveOrArchive = async (action: "leave" | "archive") => {
    setConfirm(null);
    const result = action === "archive" ? await archiveChannel({ channelId }) : await leaveChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    shell.refresh();
    if (action === "archive") refreshChannel();
    else router.push(channel.project_id ? `/messages/p/${channel.project_id}` : "/messages");
  };

  if (isDm) return <PersonDetails channel={channel} meId={meId} setState={(patch) => void setState(patch)} onClose={() => void setState({ archived: true })} />;

  const creator = (members.data ?? []).find((m) => m.id === channel.created_by);
  const createdDate = new Date(channel.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const canLeave = !channel.is_default && !channel.application_id;
  const canArchive = channel.can_admin && !isGroup && !channel.is_default && !channel.channel_archived_at;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-3 border-b border-border px-3" role="tablist" aria-label="Details">
        {(["about", "members"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => onTab(value)} className={`nb-tab -mb-px min-h-10 border-b-2 text-[13px] font-medium capitalize ${tab === value ? "border-[var(--chat-accent)]" : "border-transparent text-muted-foreground"}`}>
            {value === "members" ? `Members · ${channel.member_count}` : "About"}
          </button>
        ))}
      </div>
      <div className="app-scroll app-scroll-y min-h-0 flex-1">
        {tab === "members" ? <Members channel={channel} meId={meId} /> : (
          <div className="space-y-3 p-4">
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40">
              {isGroup ? (
                <EditableRow label="Group name" value={channel.title ?? null} placeholder="Name this group" editable={channel.is_member} onSave={saveField("title")} valid={(v) => v.length <= 80} />
              ) : (
                <EditableRow
                  label="Channel name"
                  value={channel.name}
                  placeholder=""
                  prefix="#"
                  editable={channel.can_admin}
                  onSave={saveField("name")}
                  transform={(raw) => raw.toLowerCase().replace(/\s+/g, "-").slice(0, 80)}
                  valid={(v) => CHAT_CHANNEL_NAME_PATTERN.test(v)}
                  hint="Lowercase letters, numbers and hyphens."
                />
              )}
              {channel.is_default ? (
                <p className="flex items-center gap-2 px-4 py-2 text-[12px] text-muted-foreground">
                  <span className="rounded-[3px] bg-secondary px-1.5 py-0.5 text-[10px] font-medium">Default channel</span>
                  Everyone in the project is a member.
                </p>
              ) : null}
              {!isGroup ? (
                <>
                  <EditableRow label="Topic" value={channel.topic} placeholder="Add a topic" editable={channel.is_member} onSave={saveField("topic")} transform={(raw) => raw.slice(0, 250)} />
                  <EditableRow label="Description" value={channel.description} placeholder="Add a description" editable={channel.is_member} multiline onSave={saveField("description")} transform={(raw) => raw.slice(0, CHAT_MAX_DESCRIPTION)} />
                </>
              ) : null}
              {channel.is_member ? <NotifyRow channel={channel} onChange={(notify) => void setState({ notify })} /> : null}
              {channel.project_title ? (
                <div className="p-4">
                  <span className="text-[13px] font-semibold">Project</span>
                  <p className="mt-1 text-[13px]"><Link href={`/projects/${channel.project_slug ?? channel.project_id}`} className="font-medium text-primary hover:underline">{channel.project_title}</Link></p>
                </div>
              ) : null}
              <div className="p-4">
                <span className="text-[13px] font-semibold">Created</span>
                <p className="mt-1 text-[13px] text-muted-foreground">{creator ? `By ${personName(creator)} on ` : "On "}{createdDate}</p>
              </div>
            </div>
            {channel.is_member ? <div className="rounded-xl border border-border"><ConversationShortcuts channelId={channelId} /></div> : null}
            {channel.is_member && (isGroup || channel.kind === "private") ? (
              <button type="button" onClick={() => onTab("members")} className="flex h-9 items-center gap-2 rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted"><UserPlus size={14} /> Add people</button>
            ) : null}
            {canLeave || canArchive ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {canLeave && channel.is_member ? <button type="button" onClick={() => setConfirm("leave")} className="h-9 rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted">Leave {isGroup ? "conversation" : "channel"}</button> : null}
                {canArchive ? <button type="button" onClick={() => setConfirm("archive")} className="h-9 rounded-[5px] border border-border px-3 text-[13px] font-medium text-destructive hover:bg-destructive/10">Archive channel</button> : null}
              </div>
            ) : null}
            <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
              <span className="truncate font-mono">ID: {channel.id}</span>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(channel.id); toast.success("ID copied"); }} className="ml-2 inline-flex items-center gap-1 font-medium hover:text-foreground" title="Copy ID">
                <Copy size={12} /> Copy
              </button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "archive" ? `Archive #${channel.name}?` : `Leave ${isGroup ? "this conversation" : `#${channel.name}`}?`}
        description={confirm === "archive" ? "Nobody can post in an archived channel. History stays readable, and admins can unarchive it." : channel.kind === "public" ? "You can rejoin a public channel at any time." : "You'll need to be added again to come back."}
        confirmLabel={confirm === "archive" ? "Archive" : "Leave"}
        variant="destructive"
        onConfirm={() => void leaveOrArchive(confirm ?? "leave")}
      />
    </div>
  );
}
