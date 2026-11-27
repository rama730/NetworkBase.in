import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/components/providers/theme-provider';
import NotificationPreview from '@/components/layout/header/NotificationPreview';
import type { NeedsYouItem } from '@/lib/notifications/needs-you';
import type { NotificationItem } from '@/lib/notifications/types';

// Notifications mix: the real tray with the hook's shape filled from fixtures; calls land in window.__calls.
const params = new URLSearchParams(location.search);
const w = window as unknown as Record<string, unknown>;
const calls: Array<[string, unknown]> = [];
w.__calls = calls;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => params.get('from') ?? '/discover', push: (to: string) => { w.__pushed = to; } };
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const now = Date.now();
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();

const row = (over: Partial<NotificationItem>): NotificationItem => ({
  id: over.id ?? 'n', userId: 'me', actorUserId: 'a', kind: 'task_comment_mention', importance: 'more', title: 'Row', body: null, href: '/workspaces/cse-3b?tab=tasks',
  entityRefs: { projectId: 'p1', projectSlug: 'cse-3b', taskId: 't1' }, preview: { actorName: 'Ben', contextLabel: 'CSE 3B · Data Structures' }, reason: 'mention',
  dedupeKey: over.id ?? 'n', aggregateCount: 1, readAt: null, seenAt: null, dismissedAt: null, snoozedUntil: null, createdAt: ago(2), activityAt: ago(2), updatedAt: ago(2), ...over,
});
const ITEMS: NotificationItem[] = [
  row({ id: 'm1', title: 'Ben mentioned you on Week 6 quiz', body: '@Rama can you check the heap answers before Friday?', activityAt: ago(2) }),
  row({ id: 's1', kind: 'project_sprint_activity', actorUserId: null, preview: { contextLabel: 'CSE 3B · Data Structures' }, title: 'Unit 2 started in CSE 3B', entityRefs: { projectId: 'p1', projectSlug: 'cse-3b' }, reason: 'update', activityAt: ago(5) }),
  row({ id: 'q1', kind: 'saved_search_matches', actorUserId: null, preview: null, title: '4 new matches for your saved search “react”', entityRefs: {}, reason: 'update', activityAt: ago(6) }),
  row({ id: 'l1', kind: 'project_update_like', title: 'Rama liked your post', preview: { actorName: 'Rama' }, entityRefs: { projectId: 'p1', updateId: 'u1' }, reason: 'update', activityAt: ago(1) }),
  row({ id: 'r1', kind: 'project_role_changed', title: 'Ramanayudu CH made you Teaching assistant', preview: { actorName: 'Ramanayudu CH', contextLabel: 'CSE 3B' }, seenAt: ago(70), activityAt: ago(72), entityRefs: { projectId: 'p1' }, reason: 'update' }),
];
const NEEDS: NeedsYouItem[] = [
  { key: 'review:r', source: 'review', notificationId: null, actor: { id: 'a1', name: 'Ananya Rao', avatarUrl: null }, sentence: { actor: 'Ananya Rao', verb: ' asked you to review ', object: '!12 Heap sort' }, snippet: null, context: 'CSE 3B · feature/heap-sort', href: '/workspaces/cse-3b?tab=files&mr=12', waitingSince: ago(50), blocksOthers: 0, primary: { act: 'open', label: 'Review' }, secondary: null },
  { key: 'connection:c', source: 'connection', notificationId: null, actor: { id: 'a2', name: 'Kiran Patel', avatarUrl: null }, sentence: { actor: 'Kiran Patel', verb: ' wants to connect', object: '' }, snippet: null, context: 'Teaching assistant', href: '/network?tab=invitations', waitingSince: ago(1), blocksOthers: 0, primary: { act: 'accept', label: 'Accept' }, secondary: { act: 'ignore', label: 'Ignore' } },
  { key: 'agent_question:q', source: 'agent_question', notificationId: null, actor: null, sentence: { actor: 'Claude', verb: ' asks in ', object: 'Heap visualiser' }, snippet: 'Use Postgres or SQLite for the cache?', context: 'Agent question', href: '/workspaces/hv?question=q', waitingSince: ago(3), blocksOthers: 0, primary: null, secondary: { act: 'open', label: 'Answer in chat' }, options: [{ value: 'sqlite', label: 'SQLite', recommended: true }, { value: 'pg', label: 'Postgres' }], questionKey: 'cache' },
];

function Fixture() {
  const [open, setOpen] = useState(params.get('closed') !== '1');
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [items, setItems] = useState(ITEMS);
  const [needs, setNeeds] = useState(NEEDS);
  const record = (name: string, value: unknown) => { calls.push([name, value]); };
  const visible = useMemo(() => (filter === 'unread' ? items.filter((i) => !i.seenAt) : items), [filter, items]);
  const n = {
    needs, needsYouCount: needs.length, needsLoading: false,
    act: async (item: NeedsYouItem, act: unknown) => { record('act', { key: item.key, act }); setTimeout(() => setNeeds((list) => list.filter((x) => x.key !== item.key)), 1_500); return true; },
    done: async (item: NotificationItem) => { record('done', item.id); setItems((list) => list.filter((x) => x.id !== item.id)); },
    coachKind: null, coachTurnOff: async () => {}, coachKeep: () => {},
    markAllRead: async () => { record('markAllRead', null); setItems((list) => list.map((x) => ({ ...x, seenAt: x.seenAt ?? new Date().toISOString() }))); },
    dismissRead: async () => { record('dismissRead', null); return 1; },
    reply: async (item: NotificationItem, text: string) => { record('reply', { id: item.id, text }); return true; },
    muteWorkspace: async () => {}, setOrgLevel: async () => {},
    snoozed: [], handIn: {}, lastOpenedAt: params.get('away') ? ago(72) : null, quiet: params.get('quiet') ? { kind: 'quiet', until: new Date(now + 8 * 3_600_000).toISOString() } : null, resume: async () => {},
    isError: false, items: visible, unreadCount: items.filter((i) => !i.seenAt).length, unreadImportantCount: 0,
    isLoading: false, isFetching: false, isRealtimeHealthy: true, isIdle: false, hasMore: false, isLoadingMore: false,
    activeFilter: filter, setActiveFilter: setFilter, isTrayOpen: open, openTray: () => setOpen(true), closeTray: () => setOpen(false), setTrayOpen: setOpen,
    loadMore: async () => {}, refresh: async () => {}, stageViewedNotifications: (ids: string[]) => record('viewed', ids),
    markUnread: async (id: string) => record('unread', id), dismiss: async () => {}, dismissAll: async () => {},
    muteScope: async (scope: unknown) => record('mute', scope), muteItemType: async () => {}, snooze: async (id: string, until: string) => record('snooze', { id, until }),
    openItem: async (item: NotificationItem) => { record('open', item.id); return true; },
  };
  return (
    <div>
      <header className="nb-topbar border-b border-border bg-card" style={{ height: 56, display: 'flex', justifyContent: 'flex-end' }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <NotificationPreview n={n as any} connectionHealth={(params.get('health') as 'healthy') ?? 'healthy'} />
        <div style={{ width: 56 }} />
      </header>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><ThemeProvider><Fixture /></ThemeProvider></QueryClientProvider>);
