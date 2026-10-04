"use client";

import { useQueries } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { ConversationIcon, type ConversationKind } from "@/components/messages/ConversationIcon";
import { toast } from "sonner";

import { browseChannels } from "@/app/actions/chat/channels";
import { getOrCreateDm } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, needsAttention, projectsByActivity, rowCount } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref } from "@/lib/messaging/routes";
import type { ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

type Result =
  | { type: "channel"; id: string; title: string; conversation: ConversationKind; person: ChatPerson | null; project: string | null; count: number; unread: boolean; joined: boolean }
  | { type: "person"; id: string; title: string; person: ChatPerson; canDm: boolean }
  | { type: "search"; id: string; title: string };

// ponytail: unjoined public channels from the 5 most active projects (one
// browse call each, while the switcher is open). upgrade: a server-side
// channel search when people have many projects.
const BROWSE_PROJECTS = 5;

/**
 * Cmd/Ctrl+K: recent and unread conversations first, any conversation or
 * person by name, public channels you haven't joined, and "Search messages".
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
  const browseFor = useMemo(() => (open && !onSelect ? projectsByActivity(data).slice(0, BROWSE_PROJECTS) : []), [data, onSelect, open]);
  const browsed = useQueries({
    queries: browseFor.map((project) => ({
      queryKey: queryKeys.chat.browse(project.id),
      queryFn: async () => {
        const result = await browseChannels({ projectId: project.id });
        return result.success ? result.channels.map((c) => ({ ...c, project_title: project.title })) : [];
      },
      staleTime: 60_000,
    })),
  });

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();
    const meId = user?.id ?? null;
    const projects = new Map((data?.projects ?? []).map((p) => [p.id, p.title]));
    const mine: Result[] = (data?.channels ?? [])
      .filter((c) => !c.channel_archived_at)
      .map((c) => ({
        type: "channel" as const,
        id: c.id,
        title: channelTitle(c, meId),
        conversation: c,
        person: c.dm_user,
        project: c.project_id ? projects.get(c.project_id) ?? null : null,
        count: rowCount(c),
        unread: needsAttention(c),
        joined: true,
        recent: c.last_message_at ?? "",
      }))
      .filter((r) => !needle || r.title.toLowerCase().includes(needle))
      // Unread first, then most recent: with no query this is "recent conversations".
      .sort((a, b) => Number(b.unread) - Number(a.unread) || b.recent.localeCompare(a.recent))
      .slice(0, needle ? 12 : 8)
      .map(({ recent: _recent, ...r }) => r);
    const joinedIds = new Set((data?.channels ?? []).map((c) => c.id));
    const unjoined: Result[] = needle
      ? browsed.flatMap((q) => q.data ?? [])
          .filter((c) => !c.joined && !joinedIds.has(c.id) && c.name.includes(needle))
          .slice(0, 5)
          .map((c) => ({ type: "channel" as const, id: c.id, title: c.name, conversation: { kind: "public", name: c.name }, person: null, project: c.project_title, count: 0, unread: false, joined: false }))
      : [];
    const dmUsers = new Set((data?.channels ?? []).map((c) => c.dm_user?.id).filter(Boolean));
    const found: Result[] = needle.length >= 2
      ? (people.data ?? [])
          .filter((p) => !dmUsers.has(p.id))
          .map((p) => ({ type: "person" as const, id: p.id, title: p.full_name || p.username || "Someone", person: p, canDm: p.can_dm }))
      : [];
    const search: Result[] = needle.length >= 2 && !onSelect ? [{ type: "search", id: "search", title: query.trim() }] : [];
    return [...mine, ...unjoined, ...found, ...search];
  }, [browsed, data, onSelect, people.data, query, user?.id]);

  useEffect(() => setActive(0), [query]);

  const choose = async (result: Result | undefined) => {
    if (!result) return;
    if (result.type === "search") {
      setOpen(false);
      router.push(`/messages/search?q=${encodeURIComponent(result.title)}`);
      return;
    }
    let channelId = result.id;
    if (result.type === "person") {
      if (!result.canDm) return void toast.error(chatErrorMessage("chat_dm_not_allowed"));
      const created = await getOrCreateDm({ userId: result.id });
      if (!created.success) return void toast.error(chatErrorMessage(created.error));
      channelId = created.channelId;
      refresh();
    }
    setOpen(false);
    if (onSelect) onSelect(channelId);
    else router.push(conversationHref(channelId));
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

  const joined = results.filter((r) => r.type === "channel" && r.joined);
  const browse = results.filter((r) => r.type === "channel" && !r.joined);
  const personResults = results.filter((r) => r.type === "person");
  const searchRow = results.filter((r) => r.type === "search");
  const optionId = (index: number) => `chat-switcher-option-${index}`;
  const renderOption = (result: Result) => {
    const index = results.indexOf(result);
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
        {result.type !== "search" && result.person ? <UserAvatar identity={result.person} size={24} roundedClassName="rounded-[5px]" /> : result.type === "search" ? <Search size={16} aria-hidden="true" /> : result.type === "channel" ? <ConversationIcon channel={result.conversation} size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}
        <span className={`min-w-0 flex-1 truncate ${result.type === "channel" && result.unread ? "font-semibold" : ""}`}>
          {result.type === "search" ? <>Search messages for &ldquo;{result.title}&rdquo;</> : result.title}
        </span>
        {result.type === "channel" && result.project ? <span className="max-w-[40%] flex-none truncate rounded-[3px] bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{result.project}</span> : null}
        {result.type === "channel" && !result.joined ? <span className="flex-none text-[12px] text-muted-foreground">Not joined</span> : null}
        {result.type === "channel" && result.count ? <span className="nb-chat-count">{result.count > 99 ? "99+" : result.count}</span> : null}
        {result.type === "person" && !result.canDm ? <span className="text-[12px] text-muted-foreground">Can&apos;t message</span> : null}
        {result.type === "search" ? <kbd className="flex-none font-mono text-[11px] text-muted-foreground">↵</kbd> : null}
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
            placeholder={onSelect ? "Find a channel or person" : "Jump to a conversation, or search messages"}
            role="combobox"
            aria-expanded="true"
            aria-controls="chat-switcher-results"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] outline-none pointer-coarse:text-[17px]"
          />
        </div>
        <ul id="chat-switcher-results" role="listbox" aria-label="Conversations and people" className="max-h-[50dvh] overflow-y-auto p-2">
          {joined.length ? <li role="presentation" className="nb-micro px-3 py-1.5 text-muted-foreground">{query.trim() ? "Conversations" : "Recent"}</li> : null}
          {joined.map(renderOption)}
          {browse.length ? <li role="presentation" className="nb-micro px-3 py-1.5 text-muted-foreground">Channels you can join</li> : null}
          {browse.map(renderOption)}
          {personResults.length ? <li role="presentation" className="nb-micro px-3 py-1.5 text-muted-foreground">People</li> : null}
          {personResults.map(renderOption)}
          {searchRow.map(renderOption)}
          {!results.length ? <li role="presentation" className="px-3 py-6 text-center text-[13px] text-muted-foreground">{people.isFetching ? "Searching…" : "No matches"}</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
