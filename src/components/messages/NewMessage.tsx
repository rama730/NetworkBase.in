"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { createGroup, getOrCreateDm } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { sendMessage } from "@/app/actions/chat/messages";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { UserAvatar } from "@/components/ui/UserAvatar";
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
  const { refresh } = useChatShell();
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<ChatPerson[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const people = usePeopleSearch(query);
  const candidates = (people.data ?? []).filter((p) => !to.some((t) => t.id === p.id));

  const send = async () => {
    const text = body.trim();
    if (!to.length || !text || sending) return;
    setSending(true);
    const opened = to.length === 1 ? await getOrCreateDm({ userId: to[0]!.id }) : await createGroup({ userIds: to.map((p) => p.id) });
    if (!opened.success) {
      setSending(false);
      return void toast.error(chatErrorMessage(opened.error));
    }
    const sent = await sendMessage({ channelId: opened.channelId, body: text, clientId: crypto.randomUUID() });
    setSending(false);
    if (!sent.success) return void toast.error(chatErrorMessage(sent.error));
    refresh();
    if (onOpen) onOpen(opened.channelId);
    else router.push(`/messages/${opened.channelId}`);
  };

  const content = (
    <div className="flex h-full min-h-0 flex-col">
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
          <ul className="mt-2 max-h-64 overflow-y-auto" aria-label="People">
            {candidates.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={!person.can_dm}
                  onClick={() => { setTo((list) => [...list, person]); setQuery(""); }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[15px] hover:bg-muted disabled:opacity-50"
                >
                  <UserAvatar identity={person} size={24} roundedClassName="rounded-[5px]" />
                  <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
                  {person.username ? <span className="font-mono text-[12px] text-muted-foreground">@{person.username}</span> : null}
                  {!person.can_dm ? <span className="text-[12px] text-muted-foreground">Can&apos;t message</span> : null}
                </button>
              </li>
            ))}
          </ul>
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
          <button type="button" onClick={() => void send()} disabled={!to.length || !body.trim() || sending} aria-label="Send" className="inline-flex h-8 items-center gap-1 rounded-[5px] bg-[var(--chat-accent)] px-3 text-[13px] font-medium text-white disabled:opacity-40 pointer-coarse:h-11">
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </div>
  );
  if (onOpen) return content;
  return <ViewScreen title="New message">{content}</ViewScreen>;
}
