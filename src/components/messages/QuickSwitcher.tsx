"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Hash, Lock, Search, Users } from "lucide-react";
import { toast } from "sonner";

import { getOrCreateDm } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatPerson } from "@/lib/messaging/types";

type Result =
  | { type: "channel"; id: string; title: string; icon: "hash" | "lock" | "group" | "person"; person: ChatPerson | null }
  | { type: "person"; id: string; title: string; person: ChatPerson; canDm: boolean };

/**
 * Cmd/Ctrl+K, "Find a conversation" and the topbar search on /messages (D11).
 * Filters joined conversations in memory; people come from the existing
 * people search once the query has 2+ characters. No message-text search (L-4).
 */
export function QuickSwitcher({ onSelect }: { onSelect?: (channelId: string) => void }) {
  const router = useRouter();
  const open = useChatUi((state) => state.switcherOpen);
  const setOpen = useChatUi((state) => state.setSwitcherOpen);
  const { data, refresh } = useChatShell();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const people = usePeopleSearch(query, open);

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();
    const meId = user?.id ?? null;
    const channels: Result[] = (data?.channels ?? [])
      .filter((c) => !c.channel_archived_at)
      .map((c) => ({
        type: "channel" as const,
        id: c.id,
        title: channelTitle(c, meId),
        icon: c.kind === "dm" ? ("person" as const) : c.name === null ? ("group" as const) : c.kind === "private" ? ("lock" as const) : ("hash" as const),
        person: c.dm_user,
      }))
      .filter((r) => !needle || r.title.toLowerCase().includes(needle))
      .slice(0, 12);
    const dmUsers = new Set((data?.channels ?? []).map((c) => c.dm_user?.id).filter(Boolean));
    const found: Result[] = needle.length >= 2
      ? (people.data ?? [])
          .filter((p) => !dmUsers.has(p.id))
          .map((p) => ({ type: "person" as const, id: p.id, title: p.full_name || p.username || "Someone", person: p, canDm: p.can_dm }))
      : [];
    return [...channels, ...found];
  }, [data, people.data, query, user?.id]);

  useEffect(() => setActive(0), [query]);

  const choose = async (result: Result | undefined) => {
    if (!result) return;
    let channelId = result.id;
    if (result.type === "person") {
      if (!result.canDm) {
        toast.error(chatErrorMessage("chat_dm_not_allowed"));
        return;
      }
      const created = await getOrCreateDm({ userId: result.id });
      if (!created.success) {
        toast.error(chatErrorMessage(created.error));
        return;
      }
      channelId = created.channelId;
      refresh();
    }
    setOpen(false);
    if (onSelect) onSelect(channelId);
    else router.push(`/messages/${channelId}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void choose(results[active]);
    }
  };

  const channelResults = results.filter((r) => r.type === "channel");
  const personResults = results.filter((r) => r.type === "person");
  const optionId = (index: number) => `chat-switcher-option-${index}`;
  const renderOption = (result: Result) => {
    const index = results.indexOf(result);
    const Icon = result.type === "channel" && result.icon === "hash" ? Hash : result.type === "channel" && result.icon === "lock" ? Lock : Users;
    return (
      <li
        key={`${result.type}:${result.id}`}
        id={optionId(index)}
        role="option"
        aria-selected={index === active}
        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[5px] px-3 text-[15px] ${index === active ? "bg-accent text-accent-foreground" : ""}`}
        onMouseEnter={() => setActive(index)}
        onClick={() => void choose(result)}
      >
        {result.person ? <UserAvatar identity={result.person} size={24} roundedClassName="rounded-[5px]" /> : <Icon size={16} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{result.title}</span>
        {result.type === "person" && !result.canDm ? <span className="text-[12px] text-muted-foreground">Can&apos;t message</span> : null}
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-[15%] translate-y-0 gap-0 rounded-xl p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Find a conversation</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} aria-hidden="true" className="text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find a channel or person"
            role="combobox"
            aria-expanded="true"
            aria-controls="chat-switcher-results"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] outline-none pointer-coarse:text-[17px]"
          />
        </div>
        <ul id="chat-switcher-results" role="listbox" aria-label="Conversations and people" className="max-h-[50dvh] overflow-y-auto p-2">
          {channelResults.length ? <li role="presentation" className="nb-micro px-3 py-1.5 text-muted-foreground">Channels</li> : null}
          {channelResults.map(renderOption)}
          {personResults.length ? <li role="presentation" className="nb-micro px-3 py-1.5 text-muted-foreground">People</li> : null}
          {personResults.map(renderOption)}
          {!results.length ? <li role="presentation" className="px-3 py-6 text-center text-[13px] text-muted-foreground">{people.isFetching ? "Searching…" : "No matches"}</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
