"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "@/lib/feedback";
import { X } from "lucide-react";

import { renameGroup } from "@/app/actions/chat/channels";
import { createGroup, getOrCreateDm } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { sendMessage } from "@/app/actions/chat/messages";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { readDraft, writeDraft } from "@/components/messages/chat-ui-store";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { isDirectLike, personName } from "@/lib/messaging/channel-view";
import { CHAT_MAX_GROUP_OTHERS } from "@/lib/messaging/constants";
import { conversationHref } from "@/lib/messaging/routes";
import type { ChatPerson } from "@/lib/messaging/types";

/** The draft for a New message to these people ("new" before anyone is added). */
const draftKeyFor = (to: ChatPerson[]) => (to.length ? `new-${to.map((p) => p.id).sort().join("+")}` : "new");

const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), { ssr: false });

/**
 * "To:" chips of people you may message, then the first message. One person
 * opens (or creates) the DM; more create a group chat (D8). The conversation
 * is created on the first send, from the same Composer as every conversation
 * (a draft per set of recipients; files and scheduling wait until the conversation exists).
 */
export function NewMessage({ onOpen }: { onOpen?: (channelId: string) => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { data, refresh } = useChatShell();
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<ChatPerson[]>([]);
  const [groupName, setGroupName] = useState("");
  // The group made by a send that then failed: a retry reuses it instead of creating a second one.
  const [opened, setOpened] = useState<{ key: string; channelId: string } | null>(null);
  const people = usePeopleSearch(query);

  // Suggestions when no query is typed: recent DM contacts & teammates from local bootstrap (0ms!)
  const channels = data?.channels;
  const meId = user?.id;
  const suggestedPeople = useMemo(() => {
    if (!channels) return [];
    const map = new Map<string, ChatPerson>();
    for (const c of channels) {
      if (c.kind === "dm" && c.dm_user && c.dm_user.id !== meId) {
        if (!map.has(c.dm_user.id)) map.set(c.dm_user.id, { ...c.dm_user, can_dm: true });
      }
      if (c.members_preview) {
        for (const m of c.members_preview) {
          // Sharing a group doesn't mean they accept DMs: leave can_dm unknown (the server decides).
          if (m.id !== meId && !map.has(m.id)) map.set(m.id, m);
        }
      }
    }
    return Array.from(map.values());
  }, [channels, meId]);

  const typed = query.trim().toLowerCase();
  const isSearching = typed.length >= 2;
  // From the first letter, people you know are filtered here (no unrelated suggestion for Enter
  // to pick); from two, the server's search takes over once it answers.
  const candidates = useMemo(() => {
    const local = typed
      ? suggestedPeople.filter((p) => personName(p).toLowerCase().includes(typed) || (p.username ?? "").toLowerCase().includes(typed))
      : suggestedPeople;
    const list = isSearching && people.data ? people.data : local;
    return list.filter((p) => !to.some((t) => t.id === p.id));
  }, [isSearching, people.data, suggestedPeople, to, typed]);

  // Recipients picker keys: ↑/↓ move, Enter picks, Backspace in an empty field removes the last chip.
  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, candidates.length - 1);
  // Each set of recipients has its own draft; editing the list carries what you're writing along
  // (a later New message for someone else starts empty).
  const changeTo = (next: ChatPerson[]) => {
    const from = draftKeyFor(to);
    const into = draftKeyFor(next);
    const text = readDraft(from);
    if (from !== into && text.trim() && !readDraft(into).trim()) {
      writeDraft(into, text);
      writeDraft(from, "");
    }
    setTo(next);
  };
  const pick = (person: ChatPerson) => {
    if (person.can_dm === false) return;
    changeTo([...to, person]);
    setQuery("");
    setActive(0);
  };
  const onRecipientKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!candidates.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (activeIndex + step + candidates.length) % candidates.length;
      setActive(next);
      requestAnimationFrame(() => document.getElementById(`new-message-person-${candidates[next]!.id}`)?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter" && candidates[activeIndex]) {
      event.preventDefault();
      pick(candidates[activeIndex]);
    } else if (event.key === "Backspace" && !query && to.length) {
      event.preventDefault();
      changeTo(to.slice(0, -1));
    }
  };
  const full = to.length >= CHAT_MAX_GROUP_OTHERS;

  // One person you already talk to, or a group with exactly these people: offer it instead of a new one.
  // ponytail: the bootstrap previews 3 members per group, so only groups of up to 4 (you included) match.
  // upgrade: a server-side lookup by member set if people message the same big group again.
  const recipientIds = useMemo(() => new Set(to.map((p) => p.id)), [to]);
  const existing = to.length === 1
    ? channels?.find((c) => c.kind === "dm" && c.dm_user?.id === to[0]!.id) ?? null
    : to.length > 1 && to.length <= 3
      ? channels?.find((c) => isDirectLike(c) && c.kind === "private" && !c.channel_archived_at && c.member_count === to.length + 1
        && (c.members_preview ?? []).length === to.length && (c.members_preview ?? []).every((p) => recipientIds.has(p.id))) ?? null
      : null;

  const send = async (body: string) => {
    if (!to.length) return { success: false as const, error: "chat_no_recipients" };
    const key = to.map((p) => p.id).sort().join(",");
    let channelId = opened?.key === key ? opened.channelId : existing?.id ?? null;
    if (!channelId) {
      const result = to.length === 1 ? await getOrCreateDm({ userId: to[0]!.id }) : await createGroup({ userIds: to.map((p) => p.id) });
      if (!result.success) return { success: false as const, error: result.error };
      channelId = result.channelId;
      setOpened({ key, channelId });
      if (to.length > 1 && groupName.trim()) {
        const renamed = await renameGroup({ channelId, title: groupName.trim().slice(0, 80) });
        if (!renamed.success) toast.error("Group created; its name wasn’t saved");
      }
    }
    const sent = await sendMessage({ channelId, body, clientId: crypto.randomUUID() });
    if (!sent.success) return { success: false as const, error: sent.error };
    if (onOpen) onOpen(channelId);
    else router.push(conversationHref(channelId));
    void refresh();
    return { success: true as const };
  };

  const openExisting = () => {
    if (!existing) return;
    if (onOpen) onOpen(existing.id);
    else router.push(conversationHref(existing.id));
  };

  const content = (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-muted-foreground">To:</span>
          {to.map((person) => (
            <span key={person.id} className="nbm-to-chip">
              <UserAvatar identity={person} size={20} />
              {personName(person)}
              <button type="button" onClick={() => changeTo(to.filter((p) => p.id !== person.id))} className="nbm-to-chip-x" aria-label={`Remove ${personName(person)}`}><X size={14} /></button>
            </span>
          ))}
          {!full ? (
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onRecipientKey}
              placeholder={to.length ? "Add another person" : "Type a name"}
              aria-label="Recipients"
              role="combobox"
              aria-expanded={candidates.length > 0}
              aria-controls="new-message-people"
              aria-autocomplete="list"
              aria-activedescendant={candidates[activeIndex] ? `new-message-person-${candidates[activeIndex].id}` : undefined}
              className="h-9 min-w-[160px] flex-1 bg-transparent text-[15px] outline-none pointer-coarse:h-11 pointer-coarse:text-[17px]"
            />
          ) : null}
        </div>
        {full ? <p className="mt-1 text-[13px] text-muted-foreground">A group message holds up to {CHAT_MAX_GROUP_OTHERS + 1} people, you included. Remove someone to add another.</p> : null}
        {candidates.length && !full ? (
          <div className="mt-2">
            <p className="nbm-glabel px-2 py-1">
              {isSearching && people.data ? "Search results" : typed ? "People you know" : "Recent and suggested"}
            </p>
            <ul id="new-message-people" role="listbox" className="max-h-64 overflow-y-auto" aria-label="People">
              {candidates.map((person, index) => (
                <li key={person.id} id={`new-message-person-${person.id}`} role="option" aria-selected={index === activeIndex} aria-disabled={person.can_dm === false}>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={person.can_dm === false}
                    onClick={() => pick(person)}
                    onMouseEnter={() => setActive(index)}
                    className={`nbm-popover-row nbm-sw-row${index === activeIndex ? " is-active" : ""}`}
                  >
                    <UserAvatar identity={person} size={26} />
                    <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
                    {person.username ? <span className="nbm-popover-hint">@{person.username}</span> : null}
                    {person.can_dm === false ? <span className="nbm-tag flex-none">Can’t message</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : typed ? (
          // "Searching…" until the typed name has really been searched: never a flash of "No people found".
          <p role="status" className="px-2 py-3 text-[13px] text-muted-foreground">
            {people.pending || typed.length < 2 ? "Searching…" : `No people found matching "${query}"`}
          </p>
        ) : null}
        {existing ? (
          <p className="nbm-notice">
            {to.length === 1 ? `You already have a conversation with ${personName(to[0])}.` : "You already have a group with these people; your message goes there."}
            <Button type="button" variant="link" size="sm" onClick={openExisting} className="h-auto px-0 pointer-coarse:min-h-11">Open it</Button>
          </p>
        ) : null}
        {to.length > 1 && !existing ? (
          <label className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
            Group name
            <Input value={groupName} onChange={(e) => setGroupName(e.target.value.slice(0, 80))} placeholder="Optional, e.g. Launch crew" className="h-8 min-w-0 flex-1 text-[13px] pointer-coarse:h-11" />
          </label>
        ) : null}
      </div>
      <div className="flex-1" />
      {/* Always there, so a New message draft can be seen (and finished) even before anyone is added.
          Its draft belongs to these recipients: Bob never gets the text you started for Alice. */}
      <Composer
        channelId={draftKeyFor(to)}
        placeholder={to.length ? `Message ${to.map((p) => personName(p).split(" ")[0]).join(", ")}` : "Write a message, then add who it’s for"}
        people={to}
        allowBroadcast={false}
        canCreateTask={false}
        send={send}
      />
    </div>
  );
  if (onOpen) return content;
  return <ViewScreen title="New message" closable>{content}</ViewScreen>;
}
