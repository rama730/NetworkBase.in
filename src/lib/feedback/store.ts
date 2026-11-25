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
  /** Errors that are worth trying again get a Retry button that runs this (report 0.8 #6). */
  retry?: () => void;
};
export type FeedbackItem = {
  id: FeedbackId; type: FeedbackType; title: ReactNode; description?: ReactNode;
  action?: Action; options: FeedbackOptions; duration: number; remaining: number;
  count: number; createdAt: number; updatedAt: number; revision: number;
};
export type FeedbackSnapshot = {
  items: readonly FeedbackItem[]; history: readonly FeedbackItem[];
  /** Up to three on screen at once, oldest first; the last is the front card (the mix's stack). */
  shown: readonly FeedbackId[];
  /** The front card: F8 goes here, Pending feedback's Show brings an item here. */
  currentId: FeedbackId | null;
  /** Polite region; errors go to `alert` (assertive) instead. */
  announcement: { serial: number; text: string }; alert: { serial: number; text: string }; overflow: number;
};
const EMPTY: FeedbackSnapshot = { items: [], history: [], shown: [], currentId: null, announcement: { serial: 0, text: '' }, alert: { serial: 0, text: '' }, overflow: 0 };
export const FEEDBACK_VISIBLE = 3;
const RANK: Record<FeedbackType, number> = { error: 4, warning: 3, loading: 2, info: 1, success: 0 };
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
  const words = (item: FeedbackItem) => {
    const undo = feedbackText(item.action?.label) === 'Undo' && Number.isFinite(item.duration) ? `${Math.round(item.duration / 1000)} seconds to undo.` : '';
    return [feedbackText(item.title), feedbackText(item.description), item.action ? `Action available: ${feedbackText(item.action.label)}.` : '', undo].filter(Boolean).join('. ').replace(/\.\. /g, '. ');
  };
  /** Errors interrupt (role="alert"); everything else waits its turn (role="status"). */
  const say = (item: FeedbackItem): Pick<FeedbackSnapshot, 'announcement'> | Pick<FeedbackSnapshot, 'alert'> => item.type === 'error'
    ? { alert: { serial: snapshot.alert.serial + 1, text: words(item) } }
    : { announcement: { serial: snapshot.announcement.serial + 1, text: words(item) } };
  /** Free slots go to the waiting item with the highest rank, then the oldest. */
  const fill = (items: readonly FeedbackItem[], shown: FeedbackId[]) => {
    const promoted: FeedbackItem[] = [];
    while (shown.length < FEEDBACK_VISIBLE) {
      const next = items.filter(item => !shown.includes(item.id)).sort((a, b) => RANK[b.type] - RANK[a.type] || a.createdAt - b.createdAt)[0];
      if (!next) break;
      shown.push(next.id); promoted.push(next);
    }
    return promoted;
  };
  const historyRecord = (item: FeedbackItem): FeedbackItem => ({ ...item, action: undefined, options: { context: item.options.context } });
  const archive = (item: FeedbackItem) => [...snapshot.history.filter(old => old.id !== item.id), historyRecord(item)].slice(-FEEDBACK_HISTORY_LIMIT);
  const asToast = (item: FeedbackItem): ToastT => ({ ...item.options, id: item.id, title: item.title, type: item.type, description: item.description, action: item.action });
  const remove = (id: FeedbackId, reason: 'dismiss' | 'expire' | 'action' | 'programmatic' | 'evict' = 'dismiss') => {
    const item = snapshot.items.find(item => item.id === id);
    if (!item) return;
    const items = snapshot.items.filter(item => item.id !== id);
    const shown = snapshot.shown.filter(shownId => shownId !== id);
    const promoted = fill(items, shown).at(-1);
    publish({ ...snapshot, items, shown, currentId: shown.at(-1) ?? null, history: archive(item), ...(promoted ? say(promoted) : {}) });
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
    const wasShown = snapshot.shown.includes(id);
    const item: FeedbackItem = { id, type, title, description, action, options, duration, remaining: duration,
      count: existing && options.id === undefined ? existing.count + 1 : 1,
      createdAt: existing?.createdAt ?? time, updatedAt: time, revision: (existing?.revision ?? 0) + 1 };
    let items = existing ? snapshot.items.map(old => old.id === id ? item : old) : [...snapshot.items, item];
    let history = snapshot.history;
    let overflow = snapshot.overflow;
    let settledEviction: FeedbackItem | undefined;
    if (items.length > FEEDBACK_QUEUE_LIMIT) {
      const keep = (old: FeedbackItem) => !snapshot.shown.includes(old.id) && old.id !== id;
      const candidate = items.find(old => keep(old) && !old.action && !['warning', 'error', 'loading'].includes(old.type))
        ?? items.find(old => keep(old) && !old.options.onDismiss && old.type !== 'loading');
      // Unbounded producers cannot grow memory indefinitely. Callback-bearing local commits are settled if evicted.
      const evicted = candidate ?? items.find(keep)!;
      items = items.filter(old => old.id !== evicted.id);
      history = [...history, historyRecord(evicted)].slice(-FEEDBACK_HISTORY_LIMIT);
      overflow += 1;
      settledEviction = evicted;
    }
    // A new toast joins the stack when there's room; a repeat or an update keeps its place.
    const shown = wasShown || snapshot.shown.length >= FEEDBACK_VISIBLE ? [...snapshot.shown] : [...snapshot.shown, id];
    const visible = shown.includes(id);
    publish({ ...snapshot, items, history, overflow, shown, currentId: shown.at(-1) ?? null, ...(visible || ['warning', 'error'].includes(type) ? say(item) : {}) });
    settledEviction?.options.onDismiss?.(asToast(settledEviction));
    return id;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    put, remove,
    /** Pending feedback's Show: to the front; the oldest shown non-error goes back to wait, keeping its time. */
    select(id: FeedbackId) {
      const item = snapshot.items.find(item => item.id === id);
      if (!item) return;
      const shown = [...snapshot.shown.filter(shownId => shownId !== id), id];
      if (shown.length > FEEDBACK_VISIBLE) {
        const out = shown.find(shownId => shownId !== id && snapshot.items.find(old => old.id === shownId)?.type !== 'error') ?? shown[0]!;
        shown.splice(shown.indexOf(out), 1);
      }
      publish({ ...snapshot, shown, currentId: id, ...say(item) });
    },
    advance(milliseconds: number, paused: boolean) {
      const time = now();
      for (const item of snapshot.items) {
        if (item.options.deadline !== undefined && time >= item.options.deadline) {
          remove(item.id, 'expire');
        } else if (!snapshot.shown.includes(item.id) && time - item.updatedAt > STALE_SUCCESS_MS && !item.action && ['success', 'info'].includes(item.type)) {
          remove(item.id, 'expire');
        }
      }
      const longRunning = snapshot.items.find(item => item.type === 'loading' && time - item.updatedAt >= 15_000 && item.title !== 'Still working…');
      if (longRunning) put('loading', 'Still working…', { ...longRunning.options, id: longRunning.id, description: longRunning.title });
      if (paused) return;
      // Every card on screen runs its own clock; waiting ones keep their full time.
      const step = Math.max(0, milliseconds);
      const ticking = snapshot.items.filter(item => snapshot.shown.includes(item.id) && Number.isFinite(item.remaining));
      if (!ticking.length) return;
      publish({ ...snapshot, items: snapshot.items.map(item => ticking.includes(item) ? { ...item, remaining: Math.max(0, item.remaining - step) } : item) });
      snapshot.items.filter(item => item.remaining === 0).forEach(item => remove(item.id, 'expire'));
    },
    clear() {
      generation += 1;
      const pending = snapshot.items;
      publish({ ...EMPTY, announcement: { serial: snapshot.announcement.serial + 1, text: '' }, alert: { serial: snapshot.alert.serial + 1, text: '' } });
      pending.forEach(item => item.options.onDismiss?.(asToast(item)));
    },
  };
}
export const feedbackStore = createFeedbackStore();
