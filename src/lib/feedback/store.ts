import type { ReactNode } from 'react';
import type { Action, ExternalToast, ToastT } from 'sonner';

/** Decision 46: five types. */
export type FeedbackType = 'success' | 'info' | 'warning' | 'error' | 'loading';
export type FeedbackId = string | number;
export type FeedbackOptions = ExternalToast & {
  /** An actual server deadline. Reading pauses never extend it. */
  deadline?: number;
  /** Native pickers can be cancelled without resolving the requirement. */
  dismissOnAction?: boolean;
  progress?: { completed: number; total: number };
  context?: string;
};
export type FeedbackItem = {
  id: FeedbackId; type: FeedbackType; title: ReactNode; description?: ReactNode;
  action?: Action; options: FeedbackOptions; duration: number; remaining: number;
  count: number; createdAt: number; updatedAt: number; revision: number;
};
export type FeedbackSnapshot = {
  items: readonly FeedbackItem[]; history: readonly FeedbackItem[]; currentId: FeedbackId | null;
  announcement: { serial: number; text: string }; overflow: number;
};
const EMPTY: FeedbackSnapshot = { items: [], history: [], currentId: null, announcement: { serial: 0, text: '' }, overflow: 0 };
export const FEEDBACK_QUEUE_LIMIT = 50;
export const FEEDBACK_HISTORY_LIMIT = 100;
const STALE_SUCCESS_MS = 60_000;

export function isFeedbackAction(value: unknown): value is Action {
  return Boolean(value && typeof value === 'object' && 'label' in value && 'onClick' in value && typeof value.onClick === 'function');
}
export function feedbackText(value: ReactNode): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
export function readingDuration(type: FeedbackType, options: FeedbackOptions, action?: Action) {
  // Decision 47: errors stay until closed; warnings close on their own unless they carry an action.
  if (type === 'loading' || type === 'error' || (type === 'warning' && action)) return Infinity;
  if (typeof options.duration === 'number') return options.duration === 0 ? Infinity : Math.max(0, options.duration);
  return feedbackText(action?.label) === 'Undo' ? 10_000 : action || type === 'warning' ? 6000 : 4000;
}

/** One operation identity, one reading clock. Pure store; browser ownership lives in FeedbackHost. */
export function createFeedbackStore(now: () => number = Date.now) {
  let snapshot = EMPTY;
  let nextId = 0;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: FeedbackSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const say = (item: FeedbackItem) => ({ serial: snapshot.announcement.serial + 1, text: [feedbackText(item.title), feedbackText(item.description), item.action ? `Action available: ${feedbackText(item.action.label)}.` : ''].filter(Boolean).join('. ') });
  const historyRecord = (item: FeedbackItem): FeedbackItem => ({ ...item, action: undefined, options: { context: item.options.context } });
  const archive = (item: FeedbackItem) => [...snapshot.history.filter(old => old.id !== item.id), historyRecord(item)].slice(-FEEDBACK_HISTORY_LIMIT);
  const asToast = (item: FeedbackItem): ToastT => ({ ...item.options, id: item.id, title: item.title, type: item.type, description: item.description, action: item.action });
  const remove = (id: FeedbackId, reason: 'dismiss' | 'expire' | 'action' | 'programmatic' | 'evict' = 'dismiss') => {
    const item = snapshot.items.find(item => item.id === id);
    if (!item) return;
    const items = snapshot.items.filter(item => item.id !== id);
    const priority = { error: 4, warning: 3, loading: 2, info: 1, success: 0 };
    const currentId = snapshot.currentId === id ? [...items].sort((a, b) => priority[b.type] - priority[a.type])[0]?.id ?? null : snapshot.currentId;
    const next = items.find(item => item.id === currentId);
    publish({ ...snapshot, items, currentId, history: archive(item), announcement: next && currentId !== snapshot.currentId ? say(next) : snapshot.announcement });
    if (reason === 'expire') item.options.onAutoClose?.(asToast(item));
    else if (reason === 'dismiss' || reason === 'programmatic' || reason === 'evict') item.options.onDismiss?.(asToast(item));
  };
  const put = (type: FeedbackType, title: ReactNode, options: FeedbackOptions = {}) => {
    const previousGeneration = typeof options.id === 'string' ? options.id.match(/^feedback-(\d+)-\d+$/)?.[1] : undefined;
    if (previousGeneration !== undefined && Number(previousGeneration) !== generation) return options.id!;
    const time = now();
    const action = isFeedbackAction(options.action) ? options.action : undefined;
    const duration = readingDuration(type, options, action);
    const description = typeof options.description === 'function' ? options.description() : options.description;
    const existing = options.id !== undefined ? snapshot.items.find(item => item.id === options.id) : snapshot.items.find(item =>
      item.type === type && typeof title === 'string' && item.title === title && item.description === description
      // Different action closures may refer to different objects even when copy matches.
      && !action && !item.action && type !== 'loading' && !item.options.onDismiss && !options.onDismiss);
    const id = existing?.id ?? options.id ?? `feedback-${generation}-${++nextId}`;
    const item: FeedbackItem = { id, type, title, description, action, options, duration, remaining: duration,
      count: existing && options.id === undefined ? existing.count + 1 : 1,
      createdAt: existing?.createdAt ?? time, updatedAt: time, revision: (existing?.revision ?? 0) + 1 };
    let items = existing ? snapshot.items.map(old => old.id === id ? item : old) : [...snapshot.items, item];
    let history = snapshot.history;
    let overflow = snapshot.overflow;
    let settledEviction: FeedbackItem | undefined;
    if (items.length > FEEDBACK_QUEUE_LIMIT) {
      const candidate = items.find(old => old.id !== snapshot.currentId && old.id !== id && !old.action && !['warning', 'error', 'loading'].includes(old.type))
        ?? items.find(old => old.id !== snapshot.currentId && old.id !== id && !old.options.onDismiss && old.type !== 'loading');
      // Unbounded producers cannot grow memory indefinitely. Callback-bearing local commits are settled if evicted.
      const evicted = candidate ?? items.find(old => old.id !== snapshot.currentId && old.id !== id)!;
      items = items.filter(old => old.id !== evicted.id);
      history = [...history, historyRecord(evicted)].slice(-FEEDBACK_HISTORY_LIMIT);
      overflow += 1;
      settledEviction = evicted;
    }
    const currentId = snapshot.currentId ?? id;
    publish({ ...snapshot, items, history, overflow, currentId, announcement: currentId === id || ['warning', 'error'].includes(type) ? say(item) : snapshot.announcement });
    settledEviction?.options.onDismiss?.(asToast(settledEviction));
    return id;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    put, remove,
    select(id: FeedbackId) {
      const item = snapshot.items.find(item => item.id === id);
      if (item) publish({ ...snapshot, currentId: id, announcement: say(item) });
    },
    advance(milliseconds: number, paused: boolean) {
      const time = now();
      for (const item of snapshot.items) {
        if (item.options.deadline !== undefined && time >= item.options.deadline) {
          remove(item.id, 'expire');
        } else if (item.id !== snapshot.currentId && time - item.updatedAt > STALE_SUCCESS_MS && !item.action && ['success', 'info'].includes(item.type)) {
          remove(item.id, 'expire');
        }
      }
      const longRunning = snapshot.items.find(item => item.type === 'loading' && time - item.updatedAt >= 15_000 && item.title !== 'Still working…');
      if (longRunning) put('loading', 'Still working…', { ...longRunning.options, id: longRunning.id, description: longRunning.title });
      if (paused) return;
      const current = snapshot.items.find(item => item.id === snapshot.currentId);
      if (!current || !Number.isFinite(current.remaining)) return;
      const remaining = Math.max(0, current.remaining - Math.max(0, milliseconds));
      if (remaining === 0) remove(current.id, 'expire');
      else publish({ ...snapshot, items: snapshot.items.map(item => item.id === current.id ? { ...item, remaining } : item) });
    },
    clear() {
      generation += 1;
      const pending = snapshot.items;
      publish({ ...EMPTY, announcement: { serial: snapshot.announcement.serial + 1, text: '' } });
      pending.forEach(item => item.options.onDismiss?.(asToast(item)));
    },
  };
}
export const feedbackStore = createFeedbackStore();
