"use client";
import { TabMarker } from "@/components/ui/TabMarker";
import { padCount } from "@/lib/ui/tab-marker";
import { CharCount } from "@/components/ui/CharCount";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Ban, BellOff, Flag, Link2, Lock, MessageSquare, MoreHorizontal, Search, ShieldCheck, ShieldOff, Star, User, UserMinus, UserPlus, Users, X } from "lucide-react";
import { toast } from "@/lib/feedback";

import { joinChannel, renameGroup, setChannelPrivacy, updateChannel, type ChannelDetails } from "@/app/actions/chat/channels";
import { addMembers, getOrCreateDm, removeMember, setMemberRole, setMemberState } from "@/app/actions/chat/members";
import { useChatShell, useMutedIds } from "@/components/messages/ChatShellProvider";
import { AddPeopleDialog } from "@/components/messages/parts/AddPeople";
import { useChannelDetails, useChannelMembers, usePersonContext } from "@/components/messages/useConversation";
import { PresenceAvatar } from "@/components/presence/PersonPresence";
import { PresenceBadge } from "@/components/presence/PresenceBadge";
import { StatusInline } from "@/components/presence/StatusInline";
import { usePersonPresence } from "@/components/presence/usePresence";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ReportMenuItem, useReportDialog } from "@/components/reports/ReportDialog";
import { useBlockFlow, useMuteToggle } from "@/components/privacy/BlockDialog";
import { useAuth } from "@/hooks/useAuth";
import type { ChannelMember } from "@/app/actions/chat/channels";
import { canAddPeople, notifyChoice, notifyChoices, notifyHelp, personName } from "@/lib/messaging/channel-view";
import { PersonHoverCard } from "@/components/presence/PersonHoverCard";
import { CHAT_CHANNEL_NAME_PATTERN, CHAT_MAX_DESCRIPTION } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref, type DetailsTab } from "@/lib/messaging/routes";
import type { ChatNotify } from "@/lib/messaging/types";
import { profileHref } from "@/lib/routing/identifiers";
import { queryKeys } from "@/lib/query-keys";
import { copyWithToast } from "@/lib/clipboard";
import { useConversationExit } from "@/components/messages/useConversationExit";
import { keyLabel, rovingTabKey } from "@/components/messages/keys";

type Field = "name" | "topic" | "description" | "title";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin" };

/** A row of About that edits in place: click it, type, Enter (or blur) saves, Esc cancels. `max` shows a counter. */
function EditableRow({ label, value, placeholder, editable, multiline, prefix, onSave, transform, valid = () => true, hint, max }: {
  label: string; value: string | null; placeholder: string; editable: boolean; multiline?: boolean; prefix?: string;
  onSave: (next: string) => Promise<boolean>; transform?: (raw: string) => string; valid?: (next: string) => boolean; hint?: string; max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const saving = useRef(false);
  const cancelled = useRef(false);
  const start = () => { cancelled.current = false; setDraft(value ?? ""); };
  const save = async () => {
    if (draft === null || saving.current || cancelled.current) return;
    const next = draft.trim();
    if (next === (value ?? "")) return setDraft(null);
    // Invalid: keep the field open with its error showing, never silently drop the edit.
    if (!valid(next)) return;
    saving.current = true;
    const ok = await onSave(next);
    saving.current = false;
    if (ok) setDraft(null);
  };
  const Field = multiline ? "textarea" : "input";
  return (
    <div className="nbm-drow" data-multiline={multiline ? "true" : undefined}>
      <div className="flex items-center justify-between">
        <span className="nbm-drow-label">{label}</span>
        {/* Out of the tab order: the value below is the same button for keyboards and screen readers. */}
        {editable && draft === null ? <button type="button" tabIndex={-1} aria-hidden="true" onClick={start} className="nbm-drow-edit">Edit</button> : null}
      </div>
      {draft !== null ? (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-start rounded-md border border-input bg-card px-2 focus-within:border-ring">
            {prefix ? <span className="select-none py-1.5 font-mono text-[15px] text-muted-foreground">{prefix}</span> : null}
            <Field
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
              className="w-full resize-none bg-transparent py-1.5 text-[15px] outline-none"
            />
          </div>
          <div className="flex items-start gap-3 text-[13px]">
            {hint || !valid(draft.trim()) ? <p className={`flex-1 ${valid(draft.trim()) ? "text-muted-foreground" : "text-destructive"}`}>{hint}</p> : <span className="flex-1" />}
            {/* A visible limit instead of a silent cut; red only past it (the limit itself is fine). */}
            {max ? <CharCount value={draft.length} max={max} /> : null}
          </div>
          <p className="text-[13px] text-muted-foreground">{multiline ? `${keyLabel("mod+enter")} to save · Esc to cancel` : "Enter to save · Esc to cancel"}</p>
        </div>
      ) : editable ? (
        <button
          type="button"
          aria-label={`Edit ${label.toLowerCase()}${value ? `: ${value}` : ""}`}
          onClick={start}
          className={`nbm-drow-value cursor-text ${value ? "" : "is-empty"}`}
        >
          {value ? `${prefix ?? ""}${value}` : placeholder}
        </button>
      ) : (
        // Not yours to edit: plain text, not a dimmed button.
        <p className={`nbm-drow-value ${value ? "" : "is-empty"}`}>{value ? `${prefix ?? ""}${value}` : "None"}</p>
      )}
    </div>
  );
}

/** Star and Copy link, at the top of About (and a DM's details). */
function QuickActions({ channel, onStar }: { channel: ChannelDetails; onStar?: () => void }) {
  return (
    <div className="nbm-qa">
      {onStar ? (
        <button type="button" onClick={onStar} aria-pressed={channel.starred}>
          <Star size={16} className={channel.starred ? "text-primary" : ""} fill={channel.starred ? "currentColor" : "none"} aria-hidden="true" />
          {channel.starred ? "Starred" : "Star"}
        </button>
      ) : null}
      <button type="button" onClick={() => { void copyWithToast(`${window.location.origin}${conversationHref(channel.id)}`, "Link copied"); }}>
        <Link2 size={16} aria-hidden="true" /> Copy link
      </button>
    </div>
  );
}

/** Notifications as segmented cells (the same choices the select had), the help line under them. */
function NotifyRow({ channel, onChange }: { channel: ChannelDetails; onChange: (notify: ChatNotify) => void }) {
  const id = `notify-${channel.id}`;
  const choices = notifyChoices(channel);
  const current = notifyChoice(channel, channel.notify);
  const index = Math.max(0, choices.findIndex((choice) => choice.value === current));
  return (
    <div className="nbm-drow">
      <span id={id} className="nbm-drow-label">Notifications</span>
      <div
        role="radiogroup" aria-labelledby={id} className="nbm-seg nbm-seg-wrap"
        onKeyDown={(event) => {
          const next = rovingTabKey(event, index, choices.length);
          if (next === null) return;
          onChange(choices[next]!.value as ChatNotify);
          (event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
        }}
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={current === choice.value}
            tabIndex={current === choice.value ? 0 : -1}
            onClick={() => onChange(choice.value as ChatNotify)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {/* What the choice actually does. */}
      <p className="nbm-drow-help">{notifyHelp(channel, channel.notify)}</p>
    </div>
  );
}

type BlockFlow = ReturnType<typeof useBlockFlow>;

function MemberRow({ member, channel, meId, onRemove, blocking }: { member: ChannelMember; channel: ChannelDetails; meId: string | null; onRemove: (member: ChannelMember) => void; blocking: BlockFlow }) {
  // Report a person from a channel or DM (C15): the last item of their "⋯".
  const reporting = useReportDialog({ kind: "person", targetId: member.id, noun: "person", personName: personName(member) });
  const toggleMute = useMuteToggle();
  const mutedIds = useMutedIds();
  const router = useRouter();
  const queryClient = useQueryClient();
  const presence = usePersonPresence(member.id);
  const self = member.id === meId;
  const [opening, setOpening] = useState(false);
  const message = async () => {
    if (opening) return;
    setOpening(true);
    const opening$ = getOrCreateDm({ userId: member.id }).then((result) => {
      if (!result.success) throw new Error(chatErrorMessage(result.error));
      return result.channelId;
    }).finally(() => setOpening(false));
    // No success toast: the conversation opening is the confirmation (sonner dismisses the loading one).
    toast.promise(opening$, { loading: `Opening a message with ${personName(member)}…`, error: (error: Error) => error.message });
    const channelId = await opening$.catch(() => null);
    if (channelId) router.push(conversationHref(channelId));
  };
  const role = async (next: "admin" | "member", undo = true) => {
    const result = await setMemberRole({ channelId: channel.id, userId: member.id, role: next });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channel.id) });
    const previous = next === "admin" ? "member" : "admin";
    toast.success(`${personName(member)} is now ${next === "admin" ? "an admin" : "a member"}`, undo ? { action: { label: "Undo", onClick: () => void role(previous, false) } } : undefined);
  };
  // An application thread has a fixed cast: nobody is promoted or removed by hand (the database refuses too).
  const canManage = channel.can_admin && !self && member.role !== "owner" && channel.kind !== "dm" && !channel.application_id;
  return (
    // The badge's cut-out follows the row's hover colour (no card-coloured halo).
    <div role="listitem" className="nbm-mrow group/member">
      <PersonHoverCard person={member} focusable={false}>
        <span className="inline-flex flex-none"><PresenceAvatar userId={member.id} identity={member} size={34} /></span>
      </PersonHoverCard>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <PersonHoverCard person={member} label="" className="min-w-0">
            <span className="block truncate text-[13px] font-medium hover:underline">{personName(member)}{self ? " (you)" : ""}</span>
          </PersonHoverCard>
          {presence.status?.emoji ? <span className="flex-none font-[system-ui] text-[13px]" title={presence.statusText ?? undefined}>{presence.status.emoji}</span> : null}
        </span>
        {/* No "Offline" guess before presence has loaded. */}
        <span className="block truncate text-[12px] text-muted-foreground">{presence.statusText || (presence.loaded ? presence.availabilityText : " ")}</span>
      </span>
      {/* Your own block, seen only by you (Blocking B45). */}
      {member.blocked_by_me ? <span className="nbm-tag flex-none">Blocked</span> : null}
      {ROLE_LABEL[member.role] ? <span className="nbm-tag flex-none">{ROLE_LABEL[member.role]}</span> : null}
      {!self ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="nbm-cell nb-touch-target flex-none pointer-fine:opacity-0 pointer-fine:group-hover/member:opacity-100 pointer-fine:group-focus-within/member:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100" aria-label={`Options for ${personName(member)}`}>
            <MoreHorizontal size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* No Message for someone you blocked (B44). */}
            {member.blocked_by_me ? null : <DropdownMenuItem disabled={opening} onSelect={() => void message()}><MessageSquare /> Message</DropdownMenuItem>}
            {member.username ? <DropdownMenuItem asChild><Link href={profileHref({ id: member.id, username: member.username })}><User /> View profile</Link></DropdownMenuItem> : null}
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                {member.role === "admin"
                  ? <DropdownMenuItem onSelect={() => void role("member")}><ShieldOff /> Remove as admin</DropdownMenuItem>
                  : <DropdownMenuItem onSelect={() => void role("admin")}><ShieldCheck /> Make admin</DropdownMenuItem>}
                {/* Everyone in the project is in #general; the server refuses removals there. */}
                {channel.is_default ? null : <DropdownMenuItem variant="destructive" onSelect={() => onRemove(member)}><UserMinus /> Remove from channel</DropdownMenuItem>}
              </>
            ) : null}
            <ReportMenuItem noun="person" target={reporting.target} onReport={reporting.open} />
            {member.blocked_by_me
              ? <DropdownMenuItem onSelect={() => blocking.openUnblock({ id: member.id, name: personName(member) })}><Ban /> Unblock</DropdownMenuItem>
              : <DropdownMenuItem variant="destructive" onSelect={() => blocking.openBlock({ id: member.id, name: personName(member) })}><Ban /> Block {personName(member)}</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => toggleMute({ id: member.id, name: personName(member) }, !mutedIds.has(member.id))}><BellOff /> {mutedIds.has(member.id) ? "Unmute" : "Mute"} {personName(member)}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {reporting.dialog}
    </div>
  );
}

/** Member rows loading: square soft blocks that breathe (the mix). */
function MemberRowsSkeleton() {
  return (
    <div role="status" className="space-y-3 p-2">
      <span className="sr-only">Loading members…</span>
      {[60, 45, 70].map((width) => (
        <div key={width} className="flex items-center gap-2.5">
          <span aria-hidden="true" className="nbm-sk size-[34px] flex-none" />
          <span aria-hidden="true" className="nbm-sk h-[9px]" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

// Stable identity (VIRT-01), with list semantics for screen readers.
const MEMBER_LIST = {
  List: forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function MemberList(props, ref) {
    return <div {...props} ref={ref} role="list" aria-label="Members" className="space-y-px" />;
  }),
};

function Members({ channel, meId, onAdd, onJoin, scrollParent }: { channel: ChannelDetails; meId: string | null; onAdd: () => void; onJoin: () => Promise<void>; scrollParent: HTMLElement | null }) {
  const queryClient = useQueryClient();
  const blocking = useBlockFlow("member_list");
  const members = useChannelMembers(channel.id, channel.is_member);
  const [filter, setFilter] = useState("");
  const [removing, setRemoving] = useState<ChannelMember | null>(null);
  // You first, then admins, then A–Z (stable while you scroll; presence shows on each row).
  const rank = (m: ChannelMember) => (m.id === meId ? 0 : m.role !== "member" ? 1 : 2);
  const list = (members.data ?? [])
    .filter((m) => !filter || personName(m).toLowerCase().includes(filter.toLowerCase()) || (m.username ?? "").toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || personName(a).localeCompare(personName(b)));
  // Only the rows on screen render (Virtuoso); each badge watches its own person through the shared live store.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channel.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channel.id) });
  };
  // From the confirm dialog: a failure throws, so the dialog stays open and says why.
  const remove = async () => {
    const member = removing;
    if (!member) return;
    const result = await removeMember({ channelId: channel.id, userId: member.id });
    if (!result.success) throw new Error(chatErrorMessage(result.error));
    refresh();
    const undo = async () => {
      const added = await addMembers({ channelId: channel.id, userIds: [member.id] });
      if (!added.success) return void toast.error(chatErrorMessage(added.error));
      refresh();
    };
    toast.success(`${personName(member)} was removed`, { action: { label: "Undo", onClick: () => void undo() } });
  };
  // Previewing a public channel: the list is for members, and Join is right here.
  if (!channel.is_member) {
    return (
      <EmptyState
        compact
        icon={Users}
        title={`${channel.member_count} members`}
        description={`Join #${channel.name} to see who’s here.`}
        action={channel.kind === "public" && !channel.channel_archived_at ? <Button type="button" size="sm" onClick={() => void onJoin()} className="pointer-coarse:h-11">Join channel</Button> : undefined}
        className="m-3"
      />
    );
  }
  // ponytail: the member list holds the first 500 (listMembers); the search box says so past that.
  const capped = channel.member_count > 500;
  return (
    <div className="space-y-2 p-3">
      {canAddPeople(channel) ? <button type="button" className="nbm-mcell" onClick={onAdd}><span className="nbm-popover-glyph" aria-hidden="true"><UserPlus size={14} /></span> Add people</button> : null}
      <label className="relative block">
        <span className="sr-only">Find members</span>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={capped ? "Search the first 500 members" : `Find among ${channel.member_count} members`} className="pl-9 pr-9 pointer-coarse:h-11" />
        {filter ? (
          <button type="button" onClick={() => setFilter("")} aria-label="Clear search" className="nb-icon-button absolute right-1 top-1/2 size-7 -translate-y-1/2"><X size={14} /></button>
        ) : null}
      </label>
      {members.isLoading ? <MemberRowsSkeleton /> : null}
      {members.isError ? <ErrorNotice what="Members" onRetry={() => void members.refetch()} /> : null}
      {scrollParent ? (
        <Virtuoso
          customScrollParent={scrollParent}
          data={list}
          computeItemKey={(_index, member) => member.id}
          components={MEMBER_LIST}
          itemContent={(_index, member) => <MemberRow member={member} channel={channel} meId={meId} onRemove={setRemoving} blocking={blocking} />}
        />
      ) : null}
      {members.data && !list.length ? <EmptyState compact icon={Search} title="No members match" description={`Nobody here matches "${filter}".`} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? personName(removing) : ""}?`}
        description={channel.kind === "public" ? "They can rejoin this public channel later." : "They’ll need to be added again to come back."}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={remove}
      />
      {blocking.dialog}
    </div>
  );
}

/** A DM's details: who they are, how they're doing, what you share. */
function PersonDetails({ channel, meId, setState, onClose }: { channel: ChannelDetails; meId: string | null; setState: (patch: { notify?: ChatNotify; starred?: boolean }) => void; onClose: () => void }) {
  const person = channel.dm_user;
  const self = person?.id === meId;
  const presence = usePersonPresence(person?.id);
  const context = usePersonContext(person?.id, !self);
  // Report the person from the DM's details (trust and safety §5.1); messages are reported from their own "⋯".
  const reporting = useReportDialog({ kind: "person", targetId: person?.id ?? "", noun: "person", personName: person ? personName(person) : null });
  const blocking = useBlockFlow("message");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const tz = context.data?.timeZone;
  const localTime = tz ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }) : null;
  return (
    <div className="app-scroll app-scroll-y min-h-0 flex-1 divide-y divide-border">
      <div className="space-y-2 p-4">
        <PresenceAvatar userId={person?.id} identity={person} size={72} />
        <p className="nbm-person-name">{self ? `${personName(person)} (you)` : personName(person)}</p>
        {person?.username ? <p className="nbm-person-handle">@{person.username}</p> : null}
        {presence.status ? <StatusInline emoji={presence.status.emoji} text={presence.statusText} className="text-[15px]" /> : null}
        <p className="nbm-person-meta">
          <PresenceBadge availability={presence.availability} size={10} />
          {/* No "Offline" guess before presence has loaded. */}
          {presence.loaded ? presence.availabilityText : "\u00a0"}
          {localTime ? <span>· {localTime} local time</span> : null}
        </p>
        {person?.username && !self ? (
          <div className="nbm-qa"><Link href={profileHref({ id: person.id, username: person.username })} className="nbm-qa-link"><User size={16} aria-hidden="true" /> View profile</Link></div>
        ) : null}
        <QuickActions channel={channel} onStar={() => setState({ starred: !channel.starred })} />
      </div>
      {context.data && (context.data.sharedProjects.length || context.data.sharedChannels.length) ? (
        <div className="space-y-3 p-4">
          {context.data.sharedProjects.length ? (
            <div>
              <p className="nbm-glabel mb-1"><span>Workspaces in common</span><span className="nbm-glabel-rule" aria-hidden="true" /></p>
              {context.data.sharedProjects.map((p) => <Link key={p.id} href={`/workspaces/${p.slug ?? p.id}`} className="block truncate py-0.5 text-[13px] text-primary hover:underline">{p.title}</Link>)}
            </div>
          ) : null}
          {context.data.sharedChannels.length ? (
            <div>
              <p className="nbm-glabel mb-1"><span>Channels in common</span><span className="nbm-glabel-rule" aria-hidden="true" /></p>
              {context.data.sharedChannels.map((c) => (
                <Link key={c.id} href={conversationHref(c.id)} className="block truncate py-0.5 text-[13px] hover:underline">#{c.name}{c.project_title ? <span className="text-muted-foreground"> · {c.project_title}</span> : null}</Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Notes to self: nothing to notify or close. */}
      {self ? null : <NotifyRow channel={channel} onChange={(notify) => setState({ notify })} />}
      {self ? null : (
        <div className="nbm-dgroup">
          <button type="button" onClick={onClose}><X size={16} aria-hidden="true" /> Close conversation</button>
          {person ? <button type="button" className="is-danger" onClick={reporting.open}><Flag size={16} aria-hidden="true" /> Report {personName(person)}</button> : null}
          {person ? (
            <button type="button" className={channel.blocked_by_me ? undefined : "is-danger"} onClick={() => (channel.blocked_by_me ? blocking.openUnblock : blocking.openBlock)({ id: person.id, name: personName(person) })}>
              <Ban size={16} aria-hidden="true" /> {channel.blocked_by_me ? "Unblock" : "Block"} {personName(person)}
            </button>
          ) : null}
          {reporting.dialog}
          {blocking.dialog}
        </div>
      )}
    </div>
  );
}

/** About and Members (Slack's details). Pins, files and settings live in the conversation itself. */
export function DetailsPane({ channelId, tab, onTab }: { channelId: string; tab: DetailsTab; onTab: (tab: DetailsTab) => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const details = useChannelDetails(channelId);
  const channel = details.data as ChannelDetails | undefined;
  const members = useChannelMembers(channelId, Boolean(channel?.is_member));
  const [confirm, setConfirm] = useState<"leave" | "archive" | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmPrivacy, setConfirmPrivacy] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const exit = useConversationExit({ id: channelId, project_id: channel?.project_id ?? null, kind: channel?.kind ?? "public", name: channel?.name ?? null });
  const reportChannel = useReportDialog({ kind: "chat_channel", targetId: channelId, noun: "channel" });

  if (details.isError && !channel) return <ErrorNotice what="Details" onRetry={() => void details.refetch()} className="m-4" />;
  if (!channel) {
    return (
      <div role="status" className="flex-1 space-y-4 p-4">
        <span className="sr-only">Loading details…</span>
        {[40, 70, 55].map((width) => (
          <div key={width} className="space-y-2">
            <span aria-hidden="true" className="nbm-sk h-[9px] w-20" />
            <span aria-hidden="true" className="nbm-sk h-[9px]" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    );
  }
  const isDm = channel.kind === "dm";
  const isGroup = channel.kind === "private" && channel.name === null;
  // Only a real group chat (outside projects, not an application thread) has a name you can change.
  const namedByMembers = isGroup && !channel.project_id && !channel.application_id;

  const refreshChannel = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    shell.refresh();
  };
  const setState = async (patch: { notify?: ChatNotify; starred?: boolean; archived?: boolean }) => {
    if (patch.archived) return void exit.close();
    const result = await setMemberState({ channelId, ...patch });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshChannel();
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
  const join = async () => {
    const result = await joinChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshChannel();
  };
  const switchPrivacy = async () => {
    const result = await setChannelPrivacy({ channelId, private: channel?.kind !== "private" });
    if (!result.success) throw new Error(chatErrorMessage(result.error));
    toast.success(channel?.kind === "private" ? "The channel is public now" : "The channel is private now");
    refreshChannel();
  };
  const leaveOrArchive = async (action: "leave" | "archive") => {
    if (action === "archive") await exit.archive();
    else await exit.leave();
  };

  if (isDm) return <PersonDetails channel={channel} meId={meId} setState={(patch) => void setState(patch)} onClose={() => void setState({ archived: true })} />;

  const creator = (members.data ?? []).find((m) => m.id === channel.created_by);
  const creatorName = creator ? personName(creator) : channel.created_by_name;
  const createdDate = new Date(channel.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const archived = Boolean(channel.channel_archived_at);
  // Leaving an archived channel is pointless (nobody posts there); its banner says what's possible.
  const canLeave = !channel.is_default && !channel.application_id && !archived;
  // The server lets channel admins edit name, topic and description; nothing is edited while archived.
  const canEdit = channel.can_admin && !archived;
  const tabKeys = (event: React.KeyboardEvent, index: number) => {
    const next = rovingTabKey(event, index, 2);
    if (next === null) return;
    onTab((["about", "members"] as const)[next]!);
    document.getElementById(`details-tab-${next ? "members" : "about"}`)?.focus();
  };
  const canArchive = channel.can_admin && !isGroup && !channel.is_default && !channel.channel_archived_at;
  // Same rule as chat_set_channel_privacy: admins, named project channels, never #general or an application thread.
  const canSwitchPrivacy = channel.can_admin && !isGroup && Boolean(channel.project_id) && !channel.is_default && !channel.application_id && !channel.channel_archived_at;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-3 border-b border-border px-3" role="tablist" aria-label="Details">
        {(["about", "members"] as const).map((value, index) => (
          <button
            key={value}
            id={`details-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls="details-panel"
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onTab(value)}
            onKeyDown={(event) => tabKeys(event, index)}
            className={`nb-tab -mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 text-[13px] font-medium capitalize ${tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {value === "members" ? <>Members <span className="nb-tab-count">{channel.member_count > 999 ? "999+" : <><span aria-hidden="true">{padCount(channel.member_count)}</span><span className="sr-only">{channel.member_count}</span></>}</span></> : "About"}
          </button>
        ))}
          <TabMarker overlap />
      </div>
      <div ref={setScroller} id="details-panel" role="tabpanel" aria-labelledby={`details-tab-${tab}`} className="app-scroll app-scroll-y min-h-0 flex-1">
        {tab === "members" ? <Members channel={channel} meId={meId} onAdd={() => setAdding(true)} onJoin={join} scrollParent={scroller} /> : (
          <div className="space-y-3 p-4">
            {channel.channel_archived_at ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-[13px]">
                <span className="flex-1">This channel is archived. History stays readable.</span>
                {channel.can_admin ? <Button type="button" variant="outline" size="sm" onClick={() => void exit.unarchive()} className="pointer-coarse:h-11">Unarchive</Button> : null}
              </div>
            ) : !channel.is_member && channel.kind === "public" ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-[13px]">
                <span className="flex-1">You’re previewing <strong className="font-semibold">#{channel.name}</strong>. Join to post.</span>
                <Button type="button" size="sm" onClick={() => void join()} className="pointer-coarse:h-11">Join</Button>
              </div>
            ) : null}
            <QuickActions channel={channel} onStar={channel.is_member ? () => void setState({ starred: !channel.starred }) : undefined} />
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {isGroup ? (
                <EditableRow label={namedByMembers ? "Group name" : "Name"} value={channel.title ?? null} placeholder="Name this group" editable={namedByMembers && channel.is_member && !archived} onSave={saveField("title")} valid={(v) => v.length <= 80} max={80} />
              ) : (
                <EditableRow
                  label="Channel name"
                  value={channel.name}
                  placeholder=""
                  prefix="#"
                  editable={canEdit}
                  onSave={saveField("name")}
                  transform={(raw) => raw.toLowerCase().replace(/\s+/g, "-").slice(0, 80)}
                  valid={(v) => CHAT_CHANNEL_NAME_PATTERN.test(v)}
                  hint="Lowercase letters, numbers and hyphens."
                />
              )}
              {channel.is_default ? (
                <p className="flex items-center gap-2 px-4 py-2 text-[13px] text-muted-foreground">
                  <span className="nb-tag">General channel</span>
                  Everyone in the workspace is a member.
                </p>
              ) : null}
              {!isGroup ? (
                <>
                  <EditableRow label="Topic" value={channel.topic} placeholder="Add a topic" editable={canEdit} onSave={saveField("topic")} transform={(raw) => raw.slice(0, 250)} max={250} />
                  <EditableRow label="Description" value={channel.description} placeholder="Add a description" editable={canEdit} multiline onSave={saveField("description")} transform={(raw) => raw.slice(0, CHAT_MAX_DESCRIPTION)} max={CHAT_MAX_DESCRIPTION} />
                </>
              ) : null}
              {/* An archived channel sends nothing, so it has no notification setting. */}
              {channel.is_member && !archived ? <NotifyRow channel={channel} onChange={(notify) => void setState({ notify })} /> : null}
              {canSwitchPrivacy ? (
                <div className="flex items-center gap-3 p-4">
                  <Lock size={16} aria-hidden="true" className="text-muted-foreground" />
                  <span className="flex-1">
                    <span id="privacy-label" className="nb-ui-label block">Private channel</span>
                    <span className="block text-[13px] text-muted-foreground">{channel.kind === "private" ? "Only members can see it." : "Everyone in the workspace can find and join it."}</span>
                  </span>
                  <SettingsSwitch aria-labelledby="privacy-label" checked={channel.kind === "private"} onCheckedChange={() => setConfirmPrivacy(true)} />
                </div>
              ) : null}
              {channel.project_title ? (
                <div className="p-4">
                  <span className="nb-ui-label">Workspace</span>
                  <p className="mt-1 text-[13px]"><Link href={`/workspaces/${channel.project_slug ?? channel.project_id}`} className="font-medium text-primary hover:underline">{channel.project_title}</Link></p>
                </div>
              ) : null}
              <div className="p-4">
                <span className="nb-ui-label">Created</span>
                <p className="mt-1 text-[13px] text-muted-foreground">{creatorName ? `By ${creatorName} on ` : "On "}{createdDate}</p>
              </div>
            </div>
            {/* Report a channel you didn't create (trust and safety C15); groups and DMs report people or messages instead. */}
            {!isGroup && channel.created_by !== meId ? (
              <button type="button" onClick={reportChannel.open} className="text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground">Report channel</button>
            ) : null}
            {reportChannel.dialog}
            {canLeave || canArchive ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {canLeave && channel.is_member ? <Button type="button" variant="outline" onClick={() => setConfirm("leave")} className="pointer-coarse:h-11">Leave {isGroup ? "conversation" : "channel"}</Button> : null}
                {canArchive ? <Button type="button" variant="outline" onClick={() => setConfirm("archive")} className="text-destructive hover:text-destructive pointer-coarse:h-11">Archive channel</Button> : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "archive" ? `Archive #${channel.name}?` : `Leave ${isGroup ? "this conversation" : `#${channel.name}`}?`}
        description={confirm === "archive" ? "Nobody can post in an archived channel. History stays readable, and admins can unarchive it." : channel.kind === "public" ? "You can rejoin a public channel at any time." : "You’ll need to be added again to come back."}
        confirmLabel={confirm === "archive" ? "Archive" : "Leave"}
        variant="destructive"
        onConfirm={() => leaveOrArchive(confirm ?? "leave")}
      />
      <ConfirmDialog
        open={confirmPrivacy}
        onOpenChange={setConfirmPrivacy}
        title={channel.kind === "private" ? `Make #${channel.name} public?` : `Make #${channel.name} private?`}
        description={channel.kind === "private"
          ? "Everyone in the workspace will be able to find, preview and join it."
          : "Current members stay. It’s hidden from Browse, and new people need to be added."}
        confirmLabel={channel.kind === "private" ? "Make public" : "Make private"}
        onConfirm={switchPrivacy}
      />
      {adding ? <AddPeopleDialog channelId={channelId} title={isGroup ? "this conversation" : `#${channel.name}`} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
