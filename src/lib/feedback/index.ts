import type { ReactNode } from 'react';
import type { toast as sonnerToast } from 'sonner';
import { FEEDBACK_COPY } from './copy';
import { feedbackStore, feedbackText, type FeedbackId, type FeedbackOptions, type FeedbackType } from './store';

export { feedbackStore } from './store';
export type { FeedbackOptions, FeedbackItem, FeedbackId } from './store';
type Message = ReactNode | (() => ReactNode);
type PromiseOptions<T> = NonNullable<Parameters<typeof sonnerToast.promise<T>>[1]>;
let nextPromiseId = 0;
let accountEpoch = 0;

/** Catalog keys use ’ and …; code may still send ' and ... (report §22.2 T2). */
const catalogKey = (message: string) => message.replace(/'/g, '’').replace(/\.{3}/g, '…');

export function fillTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** Catalog keys with {placeholders} match real text ("{count} files moved"), decision 44. */
const TEMPLATES = Object.entries(FEEDBACK_COPY).filter(([key]) => key.includes('{')).map(([key, entry]) => {
  const names: string[] = [];
  const source = key.split(/(\{\w+\})/).map((part) => (/^\{\w+\}$/.test(part) ? (names.push(part.slice(1, -1)), '(.+?)') : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))).join('');
  return { pattern: new RegExp(`^${source}$`), names, entry };
});

function catalogEntry(message: string) {
  const exact = FEEDBACK_COPY[message];
  if (exact) return exact;
  for (const { pattern, names, entry } of TEMPLATES) {
    const match = pattern.exec(message);
    if (!match) continue;
    const values = Object.fromEntries(names.map((name, i) => [name, match[i + 1]!]));
    return { ...entry, title: fillTemplate(entry.title, values), description: entry.description && fillTemplate(entry.description, values) };
  }
  return undefined;
}

export function compactFeedback(message: ReactNode, type: FeedbackType, options: FeedbackOptions = {}) {
  if (typeof message !== 'string') return { message, type, options };
  const contract = catalogEntry(catalogKey(message));
  if (contract) return { message: contract.title, type: contract.type ?? type, options: { ...options, description: options.description ?? contract.description } };
  if (/file.*(?:too large|exceed.*(?:size|limit))|(?:maximum|max).*upload size|file size.*exceed/i.test(message)) {
    const limit = message.match(/\b\d+(?:\.\d+)?\s*(?:KB|MB|GB)\b/i)?.[0];
    return { message: 'File too large', type: 'warning' as const, options: { ...options, description: limit ? `Upload limit: ${limit}.` : undefined } };
  }
  const progress = message.match(/^Uploading (\d+) (?:of|\/) (\d+) files?[….]*$/i);
  if (progress) return { message: `Uploading ${progress[2]} files`, type, options: { ...options, progress: { completed: Number(progress[1]), total: Number(progress[2]) } } };
  // Backend diagnostics never become visible notification copy. Known contracts keep their useful specifics.
  if (/sqlstate|postgres|constraint|database migration|stack trace|bearer\s|(?:token|secret|password)\s*[=:]|https?:\/\/[^\s]+[?&](?:token|key|signature)=/i.test(message)) {
    return { message: 'Action couldn’t finish', type: 'error' as const, options: { ...options, description: undefined } };
  }
  // Plain results (mix copy rules): no "successfully", no "!", "Copied" not "Copied to clipboard", a real ellipsis.
  const clean = message
    .replace(/^Successfully\s+(\w)/, (_m, c: string) => c.toUpperCase())
    .replace(/\s+successfully(?=[\s.!]|$)/gi, '')
    .replace(/\s+to (?:the |your )?clipboard(?=[.!]?$)/i, '')
    .replace(/!$/, '')
    .replace(/\.{3}$/, '…');
  return { message: clean, type, options };
}

/** Runtime errors are allowlisted; callers retain an operation-specific safe fallback. */
export function feedbackError(value: unknown, fallback = 'Action couldn’t finish'): string {
  const message = catalogKey(value instanceof Error ? value.message : typeof value === 'string' ? value : '');
  if (catalogEntry(message)) return message;
  if (/into (?:its )?(?:own )?(?:descendant|itself|subfolder)|move.*inside itself/i.test(message)) return 'Invalid move destination';
  if (/file.*(?:too large|exceed.*size)|file size.*exceed|maximum upload size/i.test(message)) return message;
  // Messages attachment errors name the file ("photo.png is empty."): kept only when a file name with an extension leads.
  if (/^[^\n]*\.[A-Za-z0-9]{1,8}(?: is empty\.| is too large \(max [\d.]+ [KMG]B\)\.|: SVG files can’t be attached\.)$/.test(message)) return message;
  return fallback;
}

/** Connection problems the person can fix or just try again (report 0.8 #6). */
const OFFLINE = /failed to fetch|network ?error|load failed|networkerror|timed? ?out|offline|ECONNRESET|503|502|504/i;

function emit(type: FeedbackType, message: Message, options: FeedbackOptions = {}) {
  const value = typeof message === 'function' ? message() : message;
  // Every error toast ends with its next step (0.8 #6, C5 in the app): Retry when the caller can try again, and
  // "check your connection" when the connection is what failed.
  const raw = typeof value === 'string' ? value : '';
  const { retry, ...rest } = options;
  const withStep: FeedbackOptions = type === 'error'
    ? {
        ...rest,
        ...(retry && !rest.action ? { action: { label: 'Retry', onClick: () => retry() } } : {}),
        ...(!rest.description && OFFLINE.test(raw) ? { description: retry ? 'Check your connection, then retry.' : 'Check your connection and try again.' } : {}),
      }
    : rest;
  const compact = compactFeedback(type === 'error' && typeof value === 'string' ? feedbackError(value) : value, type, withStep);
  // An error with no step of its own still says what to do (small-things F4).
  if (compact.type === 'error' && !compact.options.description && !compact.options.action) compact.options = { ...compact.options, description: 'Try again. If it keeps happening, refresh the page.' };
  return feedbackStore.put(compact.type, compact.message, compact.options);
}

const notify = (message: Message, options?: FeedbackOptions) => emit('info', message, options);
export const toast = Object.assign(notify, {
  success: (message: Message, options?: FeedbackOptions) => emit('success', message, options),
  error: (message: Message, options?: FeedbackOptions) => emit('error', message, options),
  warning: (message: Message, options?: FeedbackOptions) => emit('warning', message, options),
  info: (message: Message, options?: FeedbackOptions) => emit('info', message, options),
  message: notify,
  loading: (message: Message, options?: FeedbackOptions) => emit('loading', message, options),
  dismiss: (id?: FeedbackId) => {
    if (id === undefined) [...feedbackStore.getSnapshot().items].forEach(item => feedbackStore.remove(item.id, 'programmatic'));
    else feedbackStore.remove(id, 'programmatic');
    return id ?? '';
  },
  clear: () => { accountEpoch += 1; feedbackStore.clear(); },
  getToasts: () => feedbackStore.getSnapshot().items,
  getHistory: () => feedbackStore.getSnapshot().history,
  promise<T>(input: Promise<T> | (() => Promise<T>), options: PromiseOptions<T> = {}) {
    const id = options.id ?? `feedback-promise-${++nextPromiseId}`;
    const epoch = accountEpoch;
    let settled = false;
    let dismissed = false;
    const base: FeedbackOptions = { ...options, description: undefined, id, onDismiss: item => { dismissed = true; options.onDismiss?.(item); } };
    // A promise made by a function can simply be made again: its error toast offers Retry (0.8 #6).
    const retryBase: FeedbackOptions = typeof input === 'function' ? { ...base, retry: () => { toast.promise(input, options); } } : base;
    const timer = setTimeout(() => { if (!settled && epoch === accountEpoch && options.loading) emit('loading', options.loading, base); }, 400);
    const source = Promise.resolve().then(() => typeof input === 'function' ? input() : input);
    const result = source.then(async value => {
      settled = true;
      clearTimeout(timer);
      if (!dismissed && epoch === accountEpoch && options.success !== undefined) {
        const success = typeof options.success === 'function' ? await options.success(value) : options.success;
        const description = typeof options.description === 'function' ? await options.description(value) : options.description;
        if (success && typeof success === 'object' && 'message' in success) emit('success', success.message, { ...base, ...success, description: success.description ?? description });
        else emit('success', success, { ...base, description });
      } else if (!dismissed && epoch === accountEpoch) feedbackStore.remove(id, 'action');
      return value;
    }, async error => {
      settled = true;
      clearTimeout(timer);
      if (!dismissed && epoch === accountEpoch && options.error !== undefined) {
        const failure = typeof options.error === 'function' ? await options.error(error) : options.error;
        if (failure && typeof failure === 'object' && 'message' in failure) emit('error', failure.message, { ...retryBase, ...failure });
        else emit('error', feedbackError(failure, typeof options.error === 'string' ? options.error : 'Action couldn’t finish'), { ...retryBase, ...(OFFLINE.test(error instanceof Error ? error.message : String(error)) ? { description: 'Check your connection, then retry.' } : {}) });
      } else if (!dismissed && epoch === accountEpoch) feedbackStore.remove(id, 'action');
      throw error;
    }).finally(options.finally);
    // Observe even fire-and-forget usage, while unwrap preserves the original rejection for rollback.
    void result.catch(() => {
      const pending = feedbackStore.getSnapshot().items.find(item => item.id === id);
      if (!dismissed && epoch === accountEpoch && pending?.type === 'loading') emit('info', 'Check the operation result', { id });
    });
    return { id, unwrap: () => source };
  },
});

/** Destructive local operations use this same active clock for their UI and commit. */
export function deferredFeedback(message: string, undo: () => void, commit: () => void, restored = 'Message restored') {
  let settled = false;
  const finish = () => { if (!settled) { settled = true; commit(); } };
  const id = toast(message, {
    duration: 10_000,
    onDismiss: finish, onAutoClose: finish,
    action: { label: 'Undo', onClick: () => { if (settled) return; settled = true; undo(); toast.success(restored, { id }); } },
  });
  return { id, commit: () => { finish(); feedbackStore.remove(id, 'action'); } };
}

export function feedbackLabel(value: ReactNode) { return feedbackText(value) || 'Notification'; }

export function feedbackDate(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
}
