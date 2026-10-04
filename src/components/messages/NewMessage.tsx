"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";

import { renameGroup } from "@/app/actions/chat/channels";
import { createGroup, getOrCreateDm } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { sendMessage } from "@/app/actions/chat/messages";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { personName } from "@/lib/messaging/channel-view";
import { CHAT_MAX_GROUP_OTHERS } from "@/lib/messaging/constants";
import { conversationHref } from "@/lib/messaging/routes";
import type { ChatPerson } from "@/lib/messaging/types";

const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), { ssr: false });

/**
 * "To:" chips of people you may message, then the first message. One person
 * opens (or creates) the DM; more create a group chat (D8). The conversation
 * is created on the first send, from the same Composer as every conversation
 * (draft key "new"; files and scheduling wait until the conversation exists).
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

  const isSearching = query.trim().length >= 2;
  const candidates = useMemo(() => {
    const list = isSearching ? (people.data ?? []) : suggestedPeople;
    return list.filter((p) => !to.some((t) => t.id === p.id));
  }, [isSearching, people.data, suggestedPeople, to]);

  const send = async (body: string) => {
    const key = to.map((p) => p.id).sort().join(",");
    let channelId = opened?.key === key ? opened.channelId : null;
    if (!channelId) {
      const result = to.length === 1 ? await getOrCreateDm({ userId: to[0]!.id }) : await createGroup({ userIds: to.map((p) => p.id) });
      if (!result.success) return { success: false as const, error: result.error };
      channelId = result.channelId;
      setOpened({ key, channelId });
      if (to.length > 1 && groupName.trim()) await renameGroup({ channelId, title: groupName.trim().slice(0, 80) });
    }
    const sent = await sendMessage({ channelId, body, clientId: crypto.randomUUID() });
    if (!sent.success) return { success: false as const, error: sent.error };
    if (onOpen) onOpen(channelId);
    else router.push(conversationHref(channelId));
    void refresh();
    return { success: true as const };
  };

  // One person you already talk to: say so and offer the existing conversation.
  const existing = to.length === 1 ? channels?.find((c) => c.kind === "dm" && c.dm_user?.id === to[0]!.id) ?? null : null;
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
      {to.length ? (
        <div className="px-3 pb-2 sm:px-4">
          <Composer
            channelId="new"
            placeholder={`Message ${to.map((p) => personName(p).split(" ")[0]).join(", ")}`}
            people={to}
            allowBroadcast={false}
            canCreateTask={false}
            send={send}
          />
        </div>
      ) : (
        <p className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground">Add someone above to start the conversation.</p>
      )}
    </div>
  );
  if (onOpen) return content;
  return <ViewScreen title="New message">{content}</ViewScreen>;
}
