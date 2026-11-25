'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { PixelBeat } from '@/components/ui/PixelBeat';
import { feedbackStore, feedbackLabel } from '@/lib/feedback';
import { feedbackText, type FeedbackItem } from '@/lib/feedback/store';
import { countdownCells, overflowLabel, overflowName, stackRows, undoLabel, type StackRow } from '@/lib/feedback/stack';
import './feedback.css';

/** A 20 px square in the kind's colour with a paper mark (tick, i, !, ×); loading is an outlined square with the pixel beat. */
function Glyph({ item }: { item: FeedbackItem }) {
  return <span className="nb-feedback-glyph" data-type={item.type} aria-hidden="true">
    {item.type === 'loading' ? <PixelBeat /> : item.type === 'success' ? <Check /> : item.type === 'error' ? <X /> : <b>{item.type === 'warning' ? '!' : 'i'}</b>}
  </span>;
}

function useFeedbackOwner() {
  const [owner, setOwner] = useState<{ element: HTMLElement; kind: 'navigation' | 'fallback' | 'modal'; mobile: boolean } | null>(null);
  useEffect(() => {
    const fallback = document.createElement('div');
    fallback.className = 'nb-feedback-fallback';
    fallback.dataset.feedbackPortal = 'fallback';
    document.body.append(fallback);
    const modalSlots = new Set<HTMLElement>();
    let scheduled = 0;
    const sync = () => {
      scheduled = 0;
      const mobile = window.innerWidth < 768;
      const modals = [...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]')].filter(el => el.getClientRects().length > 0);
      const modal = modals.at(-1);
      const navigation = document.getElementById('navigation-feedback-slot');
      let element: HTMLElement = fallback, kind: 'navigation' | 'fallback' | 'modal' = 'fallback';
      if (modal) {
        let slot = modal.querySelector<HTMLElement>(':scope > [data-feedback-portal="modal"]');
        if (!slot) { slot = document.createElement('div'); slot.dataset.feedbackPortal = 'modal'; slot.className = 'nb-feedback-modal'; modal.append(slot); modalSlots.add(slot); }
        element = slot; kind = 'modal';
      } else if (!mobile && navigation && navigation.closest('#application-sidebar')?.getClientRects().length) { element = navigation; kind = 'navigation'; }
      setOwner(previous => previous?.element === element && previous.kind === kind && previous.mobile === mobile ? previous : { element, kind, mobile });
      const viewport = window.visualViewport;
      const visibleBottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
      let bottom = Math.max(16, window.innerHeight - visibleBottom + 16);
      for (const control of document.querySelectorAll<HTMLElement>('.nb-message-composer, .nb-wizard-footer, [data-feedback-obstacle]')) {
        const rect = control.getBoundingClientRect();
        if (rect.height && rect.top > visibleBottom * .45 && rect.top < visibleBottom && rect.bottom >= visibleBottom - 120) bottom = Math.max(bottom, window.innerHeight - rect.top + 16);
      }
      fallback.style.setProperty('--feedback-bottom', `${bottom}px`);
    };
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(sync); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'open', 'data-collapsed'] });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    // Composer height can change without a DOM mutation or window resize.
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    const controls = new ResizeObserver(schedule);
    const observeControls = () => document.querySelectorAll<HTMLElement>('.nb-message-composer, .nb-wizard-footer, [data-feedback-obstacle]').forEach(el => controls.observe(el));
    const controlObserver = new MutationObserver(observeControls);
    controlObserver.observe(document.body, { childList: true, subtree: true });
    observeControls(); sync();
    return () => { observer.disconnect(); controlObserver.disconnect(); controls.disconnect(); resize.disconnect(); window.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); cancelAnimationFrame(scheduled); fallback.remove(); modalSlots.forEach(slot => slot.remove()); };
  }, []);
  return owner;
}

export function FeedbackHost() {
  const snapshot = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot, feedbackStore.getServerSnapshot);
  const owner = useFeedbackOwner();
  const [reviewing, setReviewing] = useState(false);
  const [recent, setRecent] = useState(false);
  const [busy, setBusy] = useState<FeedbackItem['id'] | null>(null);
  // Hover, focus inside or F8 fans the stack out and holds every clock.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const fanned = hovered || focused || reviewing;
  const front = useRef<HTMLElement>(null);
  const queue = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // What the stack draws: the shown cards, plus any that just left, fading for 140 ms in their old place.
  const shownItems = snapshot.shown.map(id => snapshot.items.find(item => item.id === id)).filter((item): item is FeedbackItem => Boolean(item));
  const previous = useRef<StackRow<FeedbackItem>[]>([]);
  const gone = useRef(new Set<FeedbackItem['id']>());
  const timers = useRef(new Map<FeedbackItem['id'], number>());
  const [, redraw] = useState(0);
  shownItems.forEach(item => gone.current.delete(item.id));
  const rows = stackRows(previous.current.filter(row => !(row.leaving && gone.current.has(row.item.id))), shownItems);
  useEffect(() => {
    previous.current = rows;
    for (const row of rows) {
      if (!row.leaving || timers.current.has(row.item.id)) continue;
      timers.current.set(row.item.id, window.setTimeout(() => { timers.current.delete(row.item.id); gone.current.add(row.item.id); redraw(n => n + 1); }, reduced() ? 100 : 140));
    }
  });
  useEffect(() => () => timers.current.forEach(timer => clearTimeout(timer)), []);

  useEffect(() => {
    let previousTick = performance.now();
    const mountedAt = previousTick;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, now - previousTick); previousTick = now;
      feedbackStore.advance(elapsed, document.hidden || !owner || fanned || now - mountedAt < (reduced() ? 100 : 200));
    }, 100);
    const visibility = () => { previousTick = performance.now(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [owner, fanned, snapshot.currentId]);

  const focusFeedback = () => front.current?.focus({ preventScroll: true });
  const closeReview = () => { setReviewing(false); requestAnimationFrame(() => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }); else focusFeedback(); }); };
  const dismiss = (item: FeedbackItem) => {
    if (item.options.dismissible === false) return;
    const wasFocused = region.current?.contains(document.activeElement);
    feedbackStore.remove(item.id);
    if (wasFocused) setTimeout(() => { if (front.current?.isConnected) front.current.focus({ preventScroll: true }); else document.querySelector<HTMLElement>('#main-content, input, button')?.focus({ preventScroll: true }); }, reduced() ? 110 : 150);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F8') { event.preventDefault(); focusFeedback(); }
      if (event.key === 'Escape' && (reviewing || region.current?.contains(document.activeElement))) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (reviewing) { closeReview(); return; }
        const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-feedback-id]')?.dataset.feedbackId;
        const item = snapshot.items.find(item => String(item.id) === id) ?? shownItems.at(-1);
        if (item) dismiss(item);
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  });
  useEffect(() => { if (reviewing) queue.current?.focus({ preventScroll: true }); }, [reviewing]);
  useEffect(() => { setReviewing(false); setHovered(false); }, [owner?.element]);

  const runAction = async (item: FeedbackItem, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!item.action || busy !== null || item.options.deadline !== undefined && Date.now() >= item.options.deadline) return;
    const { revision, id } = item;
    setBusy(id);
    try {
      await item.action.onClick(event);
      const latest = feedbackStore.getSnapshot().items.find(old => old.id === id);
      if (latest?.revision === revision && item.options.dismissOnAction !== false) feedbackStore.remove(id, 'action');
    } catch {
      feedbackStore.put('error', 'Action couldn’t finish', { id, action: item.action });
    } finally { setBusy(null); }
  };
  if (!owner) return null;
  const waiting = Math.max(0, snapshot.items.length - snapshot.shown.length);
  const issues = snapshot.items.filter(item => !snapshot.shown.includes(item.id) && ['warning', 'error'].includes(item.type)).length;
  const list = recent ? [...snapshot.history].reverse() : snapshot.items;
  const live = rows.filter(row => !row.leaving).length;
  let after = live;
  return createPortal(<div ref={region} className="nb-feedback-system" data-empty={!rows.length && !snapshot.items.length} data-owner={owner.kind} data-mobile={owner.mobile} data-fanned={fanned}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true"><span key={snapshot.announcement.serial}>{snapshot.announcement.text}</span></div>
    <div className="sr-only" role="alert" aria-atomic="true"><span key={snapshot.alert.serial}>{snapshot.alert.text}</span></div>
    <div className="nb-feedback-stack">
      {rows.map(row => {
        const { item } = row;
        if (!row.leaving) after -= 1;
        // Cards behind the front compress into 8 px shelves (words hidden) until the stack fans out.
        const depth = Math.min(2, after);
        const shelf = !fanned && depth > 0;
        const isFront = !row.leaving && after === 0;
        const label = feedbackLabel(item.title);
        const undo = feedbackText(item.action?.label) === 'Undo' && Number.isFinite(item.remaining);
        return <article key={item.id} ref={isFront ? front : undefined} tabIndex={-1} aria-label={label}
          className="nb-feedback-card" data-type={item.type} data-shelf={shelf ? depth : undefined} data-leaving={row.leaving || undefined}
          inert={shelf || undefined} data-feedback-id={item.id} data-testid={isFront ? (row.item.options.testId ?? "toast") : undefined}
          onPointerDown={event => { if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('button')) pointer.current = { x: event.clientX, y: event.clientY }; }}
          onPointerCancel={() => { pointer.current = null; }} onPointerUp={event => { const start = pointer.current; pointer.current = null; if (start && event.clientX - start.x > 70 && Math.abs(event.clientY - start.y) < 60) dismiss(item); }}>
          <Glyph item={item} />
          <div className="nb-feedback-content" key={`${item.id}-${item.revision}`}>
            <div className="nb-feedback-title">{item.title}{item.count > 1 && <span className="nb-feedback-repeat">×{item.count}</span>}</div>
            {item.description && <div className="nb-feedback-context">{item.description}</div>}
            {item.options.progress && <div className="nb-feedback-progress-label"><span>{item.options.progress.completed} / {item.options.progress.total} files</span><span>{Math.round(item.options.progress.completed / Math.max(1, item.options.progress.total) * 100)}%</span></div>}
          </div>
          {item.action && <button type="button" className="nb-feedback-action" disabled={busy !== null || row.leaving} onClick={event => void runAction(item, event)}>{item.action.label}</button>}
          {item.options.dismissible !== false && <button type="button" className="nb-feedback-dismiss" aria-label={`Dismiss ${label}`} onClick={() => dismiss(item)}><X aria-hidden="true" /></button>}
          {undo && <div className="nb-feedback-clock" aria-hidden="true">{countdownCells(item.remaining, item.duration).map((on, i) => <i key={i} data-on={on || undefined} />)}<span>{undoLabel(item.remaining, fanned)}</span></div>}
          {item.options.progress && <div className="nb-feedback-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={item.options.progress.total} aria-valuenow={item.options.progress.completed}><i style={{ transform: `scaleX(${item.options.progress.completed / Math.max(1, item.options.progress.total)})` }} /></div>}
        </article>;
      })}
    </div>
    {waiting > 0 && <button type="button" className="nb-feedback-more" aria-label={overflowName(waiting)} aria-expanded={reviewing} aria-controls="feedback-pending" onClick={event => { origin.current = event.currentTarget; setRecent(false); setReviewing(true); }}>{overflowLabel(waiting, issues)}</button>}
    {reviewing && <div ref={queue} id="feedback-pending" className="nb-feedback-queue" tabIndex={-1} role="region" aria-label="Pending feedback">
      <div className="nb-feedback-queue-heading"><strong>{recent ? 'Recent feedback' : 'Pending feedback'}</strong><button type="button" className="nb-feedback-dismiss" aria-label="Close pending feedback" onClick={closeReview}><X aria-hidden="true" /></button></div>
      <p>Choose a message to bring to the front. Unread messages keep their reading time.</p>
      <button type="button" className="nb-feedback-history-toggle" onClick={() => setRecent(value => !value)}>{recent ? 'Back to pending' : `Recent feedback (${snapshot.history.length})`}</button>
      {snapshot.overflow > 0 && <p>Older feedback has been grouped here. Check the affected item for its current state.</p>}
      {list.length === 0 && <p>No messages here.</p>}
      {list.map(item => <div key={`${item.id}-${item.revision}`} className="nb-feedback-pending-row" data-type={item.type}><Glyph item={item} /><div><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}{item.count > 1 && <small>{item.count} repeated events</small>}</div>{!recent && <button type="button" disabled={item.id === snapshot.currentId} onClick={() => { feedbackStore.select(item.id); closeReview(); requestAnimationFrame(() => front.current?.focus({ preventScroll: true })); }}>{item.id === snapshot.currentId ? 'Current' : 'Show'}</button>}</div>)}
    </div>}
  </div>, owner.element);
}
