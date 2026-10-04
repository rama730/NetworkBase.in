"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { renameGroup } from "@/app/actions/chat/channels";
import { createGroup, getOrCreateDm } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { sendMessage } from "@/app/actions/chat/messages";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { personName } from "@/lib/messaging/channel-view";
import { CHAT_MAX_BODY, CHAT_MAX_GROUP_OTHERS } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatPerson } from "@/lib/messaging/types";

/**
 * "To:" chips of people you may message, then the first message. One person
 * opens (or creates) the DM; more create a group chat (D8). The conversation
 * is created on the first send.
 */
export function NewMessage({ onOpen }: { onOpen?: (channelId: string) => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { data, refresh } = useChatShell();
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<ChatPerson[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
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

  const isSearching = query.trim().length >= 2;
  const candidates = useMemo(() => {
    const list = isSearching ? (people.data ?? []) : suggestedPeople;
    return list.filter((p) => !to.some((t) => t.id === p.id));
  }, [isSearching, people.data, suggestedPeople, to]);

  const send = async () => {
    const text = body.trim();
    if (!to.length || !text || sending) return;
    setSending(true);
    const key = to.map((p) => p.id).sort().join(",");
    let channelId = opened?.key === key ? opened.channelId : null;
    if (!channelId) {
      const result = to.length === 1 ? await getOrCreateDm({ userId: to[0]!.id }) : await createGroup({ userIds: to.map((p) => p.id) });
      if (!result.success) {
        setSending(false);
        return void toast.error(chatErrorMessage(result.error));
      }
      channelId = result.channelId;
      setOpened({ key, channelId });
      if (to.length > 1 && groupName.trim()) await renameGroup({ channelId, title: groupName.trim().slice(0, 80) });
    }
    const sent = await sendMessage({ channelId, body: text, clientId: crypto.randomUUID() });
    setSending(false);
    if (!sent.success) return void toast.error(chatErrorMessage(sent.error));
    if (onOpen) onOpen(channelId);
    else router.push(`/messages/${channelId}`);
    void refresh();
  };

  // One person you already talk to: say so and offer the existing conversation.
  const existing = to.length === 1 ? channels?.find((c) => c.kind === "dm" && c.dm_user?.id === to[0]!.id) ?? null : null;
  const openExisting = () => {
    if (!existing) return;
    if (onOpen) onOpen(existing.id);
    else router.push(`/messages/${existing.id}`);
  };

  const content = (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-muted-foreground">To:</span>
          {to.map((person) => (
            <span key={person.id} className="inline-flex h-8 items-center gap-1 rounded-[5px] bg-secondary pl-1 pr-0.5 text-[13px]">
              <UserAvatar identity={person} size={20} roundedClassName="rounded-[3px]" />
              {personName(person)}
              <button type="button" onClick={() => setTo((list) => list.filter((p) => p.id !== person.id))} className="grid size-7 place-items-center pointer-coarse:size-11" aria-label={`Remove ${personName(person)}`}><X size={12} /></button>
            </span>
          ))}
          {to.length <= CHAT_MAX_GROUP_OTHERS - 1 ? (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={to.length ? "Add another person" : "Type a name"}
              aria-label="Recipients"
              className="h-9 min-w-[160px] flex-1 bg-transparent text-[15px] outline-none pointer-coarse:h-11 pointer-coarse:text-[17px]"
            />
          ) : null}
        </div>
        {candidates.length ? (
          <div className="mt-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isSearching ? "Search results" : "Recent & Suggested"}
            </p>
            <ul className="max-h-64 overflow-y-auto" aria-label="People">
              {candidates.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    disabled={person.can_dm === false}
                    onClick={() => { setTo((list) => [...list, person]); setQuery(""); }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[15px] hover:bg-muted disabled:opacity-50"
                  >
                    <UserAvatar identity={person} size={24} roundedClassName="rounded-[5px]" />
                    <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
                    {person.username ? <span className="font-mono text-[12px] text-muted-foreground">@{person.username}</span> : null}
                    {person.can_dm === false ? <span className="text-[12px] text-muted-foreground">Can&apos;t message</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : isSearching ? (
          <p className="flex items-center gap-2 px-2 py-3 text-[13px] text-muted-foreground">
            {people.isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Searching…
              </>
            ) : (
              `No people found matching "${query}"`
            )}
          </p>
        ) : null}
        {existing ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 rounded-[5px] bg-muted px-3 py-2 text-[13px]">
            You already have a conversation with {personName(to[0])}.
            <button type="button" onClick={openExisting} className="font-medium text-primary hover:underline">Open it</button>
          </p>
        ) : null}
        {to.length > 1 ? (
          <label className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
            Group name
            <input value={groupName} onChange={(e) => setGroupName(e.target.value.slice(0, 80))} placeholder="Optional, e.g. Launch crew" className="h-8 min-w-0 flex-1 rounded-[5px] border border-input bg-card px-2 text-[14px] text-foreground" />
          </label>
        ) : null}
      </div>
      <div className="flex-1" />
      <div className="nb-message-composer border-t border-border px-3 pt-2 sm:px-4">
        <div className="flex items-end gap-2 rounded-lg border border-input p-1">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, CHAT_MAX_BODY))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={2}
            placeholder={to.length ? `Message ${to.map((p) => personName(p).split(" ")[0]).join(", ")}` : "Write a message"}
            aria-label="Message"
            className="block max-h-[160px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none pointer-coarse:text-[17px]"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!to.length || !body.trim() || sending}
            aria-label="Send"
            className="inline-flex h-8 items-center gap-1 rounded-[5px] bg-primary text-primary-foreground px-3 text-[13px] font-medium disabled:opacity-40 transition-colors pointer-coarse:h-11"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
  if (onOpen) return content;
  return <ViewScreen title="New message">{content}</ViewScreen>;
}
