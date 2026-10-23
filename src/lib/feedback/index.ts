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

export function compactFeedback(message: ReactNode, type: FeedbackType, options: FeedbackOptions = {}) {
  if (typeof message !== 'string') return { message, type, options };
  const action = options.action;
  if (action && typeof action === 'object' && 'label' in action && typeof action.label === 'string') {
    const labels: Record<string, string> = { 'Open details': 'Rename group', 'Review changes': 'Review', 'Review canvas': 'Review', 'Review permissions': 'Check access', 'View application': 'View', 'Open security': 'Security', 'Generate codes': 'Get codes' };
    options = { ...options, action: { ...action, label: labels[action.label] ?? action.label } };
  }
  const contract = FEEDBACK_COPY[message];
  if (contract) return { message: contract.title, type: contract.type ?? type, options: { ...options, description: options.description ?? contract.description } };
  if (/file.*(?:too large|exceed.*(?:size|limit))|(?:maximum|max).*upload size|file size.*exceed/i.test(message)) {
    const limit = message.match(/\b\d+(?:\.\d+)?\s*(?:KB|MB|GB)\b/i)?.[0];
    return { message: 'File too large', type: 'warning' as const, options: { ...options, description: limit ? `Upload limit: ${limit}.` : undefined } };
  }
  if (/^Project created[,\.]/.test(message)) {
    const count = message.match(/(\d+) file/);
    const description = /picture|image/i.test(message) ? 'Image upload failed.' : /leaders only/i.test(message) ? 'Docs stay leaders-only.' : count ? `${count[1]} files failed.` : undefined;
    if (description) return { message: 'Project created', type: 'warning' as const, options: { ...options, description } };
  }
  const progress = message.match(/^Uploading (\d+) (?:of|\/) (\d+) files?[….]*$/i);
  if (progress) return { message: `Uploading ${progress[2]} files`, type, options: { ...options, progress: { completed: Number(progress[1]), total: Number(progress[2]) } } };
  // Backend diagnostics never become visible notification copy. Known contracts keep their useful specifics.
  if (/sqlstate|postgres|constraint|database migration|stack trace|bearer\s|(?:token|secret|password)\s*[=:]|https?:\/\/[^\s]+[?&](?:token|key|signature)=/i.test(message)) {
    return { message: 'Action couldn’t finish', type: 'error' as const, options: { ...options, description: undefined } };
  }
  const clean = message.replace(/\s+successfully[.!]?$/i, '').replace(/!$/, '').replace(/\.{3}$/, '…');
  return { message: clean, type, options };
}

/** Runtime errors are allowlisted; callers retain an operation-specific safe fallback. */
export function feedbackError(value: unknown, fallback = 'Action couldn’t finish'): string {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  if (FEEDBACK_COPY[message]) return message;
  if (/into (?:its )?(?:own )?(?:descendant|itself|subfolder)|move.*inside itself/i.test(message)) return 'Invalid move destination';
  if (/file.*(?:too large|exceed.*size)|file size.*exceed|maximum upload size/i.test(message)) return message;
  return fallback;
}

function emit(type: FeedbackType, message: Message, options: FeedbackOptions = {}) {
  const value = typeof message === 'function' ? message() : message;
  const compact = compactFeedback(type === 'error' && typeof value === 'string' ? feedbackError(value) : value, type, options);
  return feedbackStore.put(compact.type, compact.message, compact.options);
}

const notify = (message: Message, options?: FeedbackOptions) => emit('neutral', message, options);
export const toast = Object.assign(notify, {
  success: (message: Message, options?: FeedbackOptions) => emit('success', message, options),
  error: (message: Message, options?: FeedbackOptions) => emit('error', message, options),
  warning: (message: Message, options?: FeedbackOptions) => emit('warning', message, options),
  info: (message: Message, options?: FeedbackOptions) => emit('info', message, options),
  message: notify,
  activity: (message: Message, options?: FeedbackOptions) => emit('activity', message, options),
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
        if (failure && typeof failure === 'object' && 'message' in failure) emit('error', failure.message, { ...base, ...failure });
        else emit('error', feedbackError(failure, typeof options.error === 'string' ? options.error : 'Action couldn’t finish'), base);
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
export function deferredFeedback(message: string, undo: () => void, commit: () => void) {
  let settled = false;
  const finish = () => { if (!settled) { settled = true; commit(); } };
  const id = toast(message, {
    duration: 10_000,
    onDismiss: finish, onAutoClose: finish,
    action: { label: 'Undo', onClick: () => { if (settled) return; settled = true; undo(); toast.success('Message restored', { id }); } },
  });
  return { id, commit: () => { finish(); feedbackStore.remove(id, 'action'); } };
}

export function feedbackLabel(value: ReactNode) { return feedbackText(value) || 'Notification'; }

export function feedbackDate(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
}
