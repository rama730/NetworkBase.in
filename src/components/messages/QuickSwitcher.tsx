"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { ConversationIcon, type ConversationKind } from "@/components/messages/ConversationIcon";
import { keyLabel } from "@/components/messages/keys";
import { toast } from "sonner";

import { searchChannels } from "@/app/actions/chat/channels";
import { getOrCreateDm } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, counterpart, isVisible, needsAttention, personName, rowCount } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref } from "@/lib/messaging/routes";
import type { ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

type Result =
  | { type: "channel"; id: string; title: string; conversation: ConversationKind; person: ChatPerson | null; project: string | null; count: number; unread: boolean; joined: boolean }
  | { type: "person"; id: string; title: string; person: ChatPerson; canDm: boolean }
  | { type: "search"; id: string; title: string };

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
  const [opening, setOpening] = useState<string | null>(null);
  const [channelNeedle, setChannelNeedle] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const people = usePeopleSearch(query, open);
  // Public channels you haven't joined, in every project you're in (one server search, 250 ms after typing stops).
  useEffect(() => {
    const timer = setTimeout(() => setChannelNeedle(query.trim().toLowerCase().replace(/^#/, "")), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const unjoinedChannels = useQuery({
    queryKey: queryKeys.chat.channelSearch(channelNeedle),
    enabled: open && !onSelect && channelNeedle.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await searchChannels({ query: channelNeedle });
      return result.success ? result.channels : [];
    },
  });

  const results = useMemo<Result[]>(() => {
    // "#gen" finds #general: channel names have no "#".
    const needle = query.trim().toLowerCase().replace(/^#/, "");
    const meId = user?.id ?? null;
    const projects = new Map((data?.projects ?? []).map((p) => [p.id, p.title]));
    // Recent: what the sidebar shows (closed and archived ones stay out); a typed name also finds closed DMs.
    const mine: Result[] = (data?.channels ?? [])
      .filter((c) => (needle ? !c.channel_archived_at : isVisible(c)))
      .map((c) => ({
        type: "channel" as const,
        id: c.id,
        title: channelTitle(c, meId),
        conversation: c,
        person: c.dm_user ?? counterpart(c),
        project: c.project_id ? projects.get(c.project_id) ?? null : null,
        count: rowCount(c),
        unread: needsAttention(c),
        joined: true,
        recent: c.last_message_at ?? "",
        // An application thread is also found by its project, its role and the applicant.
        extra: c.application ? [c.application.project_title, c.application.role_title, personName(c.application.applicant)].filter(Boolean).join(" ").toLowerCase() : "",
      }))
      .filter((r) => !needle || r.title.toLowerCase().includes(needle) || r.extra.includes(needle))
      // Unread first, then most recent: with no query this is "recent conversations".
      .sort((a, b) => Number(b.unread) - Number(a.unread) || b.recent.localeCompare(a.recent))
      .slice(0, needle ? 12 : 8)
      .map(({ recent: _recent, extra: _extra, ...r }) => r);
    const joinedIds = new Set((data?.channels ?? []).map((c) => c.id));
    const unjoined: Result[] = needle
      ? (unjoinedChannels.data ?? [])
          .filter((c) => !joinedIds.has(c.id) && c.name.includes(needle))
          .slice(0, 5)
          .map((c) => ({ type: "channel" as const, id: c.id, title: c.name, conversation: { kind: "public", name: c.name }, person: null, project: c.project_title, count: 0, unread: false, joined: false }))
      : [];
    const dmUsers = new Set((data?.channels ?? []).map((c) => c.dm_user?.id).filter(Boolean));
    const found: Result[] = needle.length >= 2
      ? (people.data ?? [])
          .filter((p) => !dmUsers.has(p.id))
          .map((p) => ({ type: "person" as const, id: p.id, title: p.full_name || p.username || "Someone", person: p, canDm: p.can_dm }))
      : [];
    // Message search is always one row away, typed or not (empty: opens the search page).
    const search: Result[] = !onSelect ? [{ type: "search", id: "search", title: needle.length >= 2 ? query.trim() : "" }] : [];
    return [...mine, ...unjoined, ...found, ...search];
  }, [data, onSelect, people.data, query, unjoinedChannels.data, user?.id]);

  useEffect(() => setActive(0), [query]);
  // Arrow keys keep the highlighted option in view.
  useEffect(() => {
    if (open) document.getElementById(`chat-switcher-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = async (result: Result | undefined) => {
    if (!result) return;
    if (result.type === "search") {
      setOpen(false);
      router.push(result.title ? `/messages/search?q=${encodeURIComponent(result.title)}` : "/messages/search");
      return;
    }
    let channelId = result.id;
    if (result.type === "person") {
      if (!result.canDm) return void toast.error(chatErrorMessage("chat_dm_not_allowed"));
      if (opening) return;
      setOpening(result.id);
      const created = await getOrCreateDm({ userId: result.id }).finally(() => setOpening(null));
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
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      // ⌘/Ctrl+Enter: straight to message search, whatever is highlighted.
      event.preventDefault();
      if (query.trim().length >= 2 && !onSelect) void choose({ type: "search", id: "search", title: query.trim() });
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
        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-[15px] ${index === active ? "bg-accent text-accent-foreground" : ""}`}
        onMouseEnter={() => setActive(index)}
        onClick={() => void choose(result)}
      >
        {result.type !== "search" && result.person ? <UserAvatar identity={result.person} size={26} /> : result.type === "search" ? <Search size={16} aria-hidden="true" /> : result.type === "channel" ? <ConversationIcon channel={result.conversation} size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}
        <span className={`min-w-0 flex-1 truncate ${result.type === "channel" && result.unread ? "font-semibold" : ""}`}>
          {result.type === "search" ? (result.title ? <>Search messages for &ldquo;{result.title}&rdquo;</> : "Search messages…") : result.title}
        </span>
        {result.type === "channel" && result.project ? <span className="nb-tag max-w-[40%] flex-none truncate">{result.project}</span> : null}
        {result.type === "channel" && !result.joined ? <span className="nb-meta flex-none">Not joined</span> : null}
        {result.type === "channel" && result.count ? <span className="nb-chat-count">{result.count > 99 ? "99+" : result.count}<span className="sr-only"> unread</span></span> : result.type === "channel" && result.unread ? <span className="sr-only">, unread</span> : null}
        {result.type === "person" && !result.canDm ? <span className="text-[13px] text-muted-foreground">Can&apos;t message</span> : null}
        {result.type === "person" && opening === result.id ? <span role="status" className="nb-meta">Opening…</span> : null}
        {result.type === "search" ? <kbd className="nb-meta flex-none">{keyLabel("mod+enter")}</kbd> : null}
      </li>
    );
  };

  // Each kind of result is a labelled group of options inside the one listbox.
  const group = (id: string, label: string, items: Result[]) => (items.length ? (
    <li role="presentation">
      <ul role="group" aria-labelledby={`chat-switcher-group-${id}`}>
        <li role="presentation" id={`chat-switcher-group-${id}`} className="nb-micro px-3 py-1.5 text-muted-foreground">{label}</li>
        {items.map(renderOption)}
      </ul>
    </li>
  ) : null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-[15%] translate-y-0 gap-0 rounded-xl p-0 sm:max-w-xl">
        {/* The same words as the sidebar row that opens it. */}
        <DialogTitle className="sr-only">Jump to a conversation</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} aria-hidden="true" className="text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={onSelect ? "Find a channel or person" : "Jump to a conversation, or search messages"}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="chat-switcher-results"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] outline-none pointer-coarse:text-[17px]"
          />
        </div>
        <ul id="chat-switcher-results" role="listbox" aria-label="Conversations and people" className="max-h-[50dvh] overflow-y-auto p-2">
          {group("joined", query.trim() ? "Conversations" : "Recent", joined)}
          {group("browse", "Channels you can join", browse)}
          {group("people", "People", personResults)}
          {searchRow.map(renderOption)}
          {!results.some((r) => r.type !== "search") && query.trim() ? <li role="presentation" className="px-3 py-6 text-center text-[13px] text-muted-foreground">{people.pending ? "Searching…" : "No conversations or people match"}</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
