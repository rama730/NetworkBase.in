'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Layers, Loader2, TriangleAlert, X, XCircle } from 'lucide-react';
import { feedbackStore, feedbackLabel } from '@/lib/feedback';
import { feedbackText, type FeedbackItem } from '@/lib/feedback/store';
import { useUIStore } from '@/stores/ui-store';
import './feedback.css';

const ICONS = { success: CheckCircle2, error: XCircle, warning: TriangleAlert, info: Info, loading: Loader2 };
const RANK = { error: 4, warning: 3, loading: 2, info: 1, success: 0 };
function StatusIcon({ item }: { item: FeedbackItem }) { const Icon = ICONS[item.type]; return <Icon aria-hidden="true" className={item.type === 'loading' ? 'nb-feedback-spinner' : undefined} />; }

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
  const collapsed = useUIStore(state => state.sidebarCollapsed);
  const setCollapsed = useUIStore(state => state.setSidebarCollapsed);
  const owner = useFeedbackOwner();
  const current = snapshot.items.find(item => item.id === snapshot.currentId) ?? null;
  const [displayed, setDisplayed] = useState<FeedbackItem | null>(null);
  const [exiting, setExiting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [recent, setRecent] = useState(false);
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLElement>(null);
  const queue = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const paused = useRef(false);
  const collapsedHere = owner?.kind === 'navigation' && collapsed;
  const shown = displayed?.id === current?.id ? current : displayed;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (displayed?.id === current?.id) return;
    if (!displayed) { setDisplayed(current); setExiting(false); return; }
    setExiting(true);
    const timer = setTimeout(() => {
      const latest = feedbackStore.getSnapshot();
      setDisplayed(latest.items.find(item => item.id === latest.currentId) ?? null);
      setExiting(false);
    }, reduced() ? 100 : 140);
    return () => clearTimeout(timer);
  }, [current?.id, displayed?.id]);
  useEffect(() => {
    if (displayed?.id === current?.id && displayed?.revision !== current?.revision) setDisplayed(current);
  }, [current?.id, current?.revision, displayed?.id, displayed?.revision]);

  useEffect(() => {
    let previous = performance.now();
    const mountedAt = previous;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, now - previous); previous = now;
      const el = region.current;
      const focus = el?.contains(document.activeElement) ?? false;
      feedbackStore.advance(elapsed, document.hidden || !owner || collapsedHere || reviewing || exiting || paused.current || focus || now - mountedAt < (reduced() ? 100 : 200));
    }, 100);
    const visibility = () => { previous = performance.now(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [owner, collapsedHere, reviewing, exiting, current?.id]);

  const focusFeedback = () => (collapsedHere ? chip.current : card.current)?.focus({ preventScroll: true });
  const closeReview = () => { setReviewing(false); requestAnimationFrame(() => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }); else focusFeedback(); }); };
  const dismiss = () => {
    if (!shown || exiting || shown.options.dismissible === false) return;
    const wasFocused = card.current?.contains(document.activeElement);
    feedbackStore.remove(shown.id);
    if (wasFocused) setTimeout(() => { if (card.current?.isConnected) card.current.focus({ preventScroll: true }); else document.querySelector<HTMLElement>('#application-sidebar a[aria-current="page"], #main-content, input, button')?.focus({ preventScroll: true }); }, reduced() ? 110 : 150);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F8') { event.preventDefault(); focusFeedback(); }
      if (event.key === 'Escape' && (reviewing || region.current?.contains(document.activeElement))) {
        event.preventDefault(); event.stopImmediatePropagation(); if (reviewing) closeReview(); else dismiss();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  });
  useEffect(() => { if (reviewing) queue.current?.focus({ preventScroll: true }); }, [reviewing]);
  useEffect(() => { setReviewing(false); paused.current = false; }, [owner?.element]);
  useEffect(() => { setBusy(false); }, [current?.id, current?.revision]);

  const runAction = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!shown?.action || exiting || busy || shown.options.deadline !== undefined && Date.now() >= shown.options.deadline) return;
    const revision = shown.revision, id = shown.id;
    setBusy(true);
    try {
      await shown.action.onClick(event);
      const latest = feedbackStore.getSnapshot().items.find(item => item.id === id);
      if (latest?.revision === revision && shown.options.dismissOnAction !== false) feedbackStore.remove(id, 'action');
    } catch {
      feedbackStore.put('error', 'Action couldn’t finish', { id, action: shown.action });
    } finally { setBusy(false); }
  };
  if (!owner) return null;
  const waiting = Math.max(0, snapshot.items.length - 1);
  const issues = snapshot.items.filter(item => item.id !== snapshot.currentId && ['warning', 'error'].includes(item.type)).length;
  const highest = [...snapshot.items].sort((a, b) => RANK[b.type] - RANK[a.type])[0];
  const label = shown ? feedbackLabel(shown.title) : 'Notification';
  const inlineContext = Boolean(shown?.description && shown.action && feedbackText(shown.description).length <= 22 && feedbackText(shown.description).length + feedbackText(shown.action.label).length <= 31);
  const list = recent ? [...snapshot.history].reverse() : snapshot.items;
  return createPortal(<div ref={region} className="nb-feedback-system" data-empty={!shown && !snapshot.items.length} data-owner={owner.kind} data-mobile={owner.mobile} data-collapsed={collapsedHere} onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }}>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true"><span key={snapshot.announcement.serial}>{snapshot.announcement.text}</span></div>
    {collapsedHere ? highest && <button ref={chip} type="button" className="nb-feedback-chip" data-type={highest.type} aria-label={`${feedbackLabel(highest.title)}. ${snapshot.items.length} pending messages. Expand navigation to review.`} onClick={() => {
      setCollapsed(false); try { localStorage.setItem('networkbase:sidebar-collapsed', 'false'); } catch { /* Navigation still expands. */ }
      feedbackStore.select(highest.id); requestAnimationFrame(() => card.current?.focus({ preventScroll: true }));
    }}><StatusIcon item={highest} />{snapshot.items.length > 1 && <span>{snapshot.items.length}</span>}</button> : <>
      {shown && <article key={shown.id} ref={card} tabIndex={-1} aria-label={label} className={`nb-feedback-card${exiting ? ' nb-feedback-exit' : ''}`} data-type={shown.type} data-feedback-id={shown.id} data-testid={shown.options.testId ?? "toast"}
        onPointerDown={event => { if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('button')) pointer.current = { x: event.clientX, y: event.clientY }; }}
        onPointerCancel={() => { pointer.current = null; }} onPointerUp={event => { const start = pointer.current; pointer.current = null; if (start && event.clientX - start.x > 70 && Math.abs(event.clientY - start.y) < 60) dismiss(); }}>
        <span className="nb-feedback-status"><StatusIcon item={shown} /></span>
        <div className="nb-feedback-content" key={`${shown.id}-${shown.revision}`}>
          <div className="nb-feedback-title">{shown.title}{shown.count > 1 && <span className="nb-feedback-repeat">×{shown.count}</span>}</div>
          {shown.description && !inlineContext && <div className="nb-feedback-context">{shown.description}</div>}
          {shown.options.progress && <div className="nb-feedback-progress-label"><span>{shown.options.progress.completed} / {shown.options.progress.total} files</span><span>{Math.round(shown.options.progress.completed / Math.max(1, shown.options.progress.total) * 100)}%</span></div>}
        </div>
        {shown.options.dismissible !== false && <button type="button" className="nb-feedback-dismiss" aria-label={`Dismiss ${label}`} onClick={dismiss}><X aria-hidden="true" /></button>}
        {shown.action && <div className="nb-feedback-footer">{inlineContext && <span className="nb-feedback-inline-context">{shown.description}</span>}<button type="button" className="nb-feedback-action" disabled={busy || exiting} onClick={event => void runAction(event)}>{shown.action.label}</button>{feedbackText(shown.action.label) === 'Undo' && Number.isFinite(shown.remaining) && <span className="nb-feedback-seconds" aria-hidden="true">{Math.ceil(shown.remaining / 1000)}s</span>}</div>}
        {shown.options.progress && <div className="nb-feedback-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={shown.options.progress.total} aria-valuenow={shown.options.progress.completed}><i style={{ transform: `scaleX(${shown.options.progress.completed / Math.max(1, shown.options.progress.total)})` }} /></div>}
        {feedbackText(shown.action?.label) === 'Undo' && Number.isFinite(shown.remaining) && <div className="nb-feedback-countdown" aria-hidden="true" style={{ transform: `scaleX(${shown.remaining / shown.duration})` }} />}
      </article>}
      {waiting > 0 && <button type="button" className="nb-feedback-queue-trigger" aria-expanded={reviewing} aria-controls="feedback-pending" onClick={event => { origin.current = event.currentTarget; setRecent(false); setReviewing(true); }}><span>{waiting} waiting{issues ? ` · ${issues} issue${issues === 1 ? '' : 's'}` : ''}</span><Layers aria-hidden="true" /></button>}
    </>}
    {reviewing && <div ref={queue} id="feedback-pending" className="nb-feedback-queue" tabIndex={-1} role="region" aria-label="Pending feedback">
      <div className="nb-feedback-queue-heading"><strong>{recent ? 'Recent feedback' : 'Pending feedback'}</strong><button type="button" className="nb-feedback-dismiss" aria-label="Close pending feedback" onClick={closeReview}><X aria-hidden="true" /></button></div>
      <p>Choose a message to show in the navigation. Unread messages keep their reading time.</p>
      <button type="button" className="nb-feedback-history-toggle" onClick={() => setRecent(value => !value)}>{recent ? 'Back to pending' : `Recent feedback (${snapshot.history.length})`}</button>
      {snapshot.overflow > 0 && <p>Older feedback has been grouped here. Check the affected item for its current state.</p>}
      {list.length === 0 && <p>No messages here.</p>}
      {list.map(item => <div key={`${item.id}-${item.revision}`} className="nb-feedback-pending-row" data-type={item.type}><StatusIcon item={item} /><div><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}{item.count > 1 && <small>{item.count} repeated events</small>}</div>{!recent && <button type="button" disabled={item.id === snapshot.currentId} onClick={() => { feedbackStore.select(item.id); closeReview(); requestAnimationFrame(() => card.current?.focus({ preventScroll: true })); }}>{item.id === snapshot.currentId ? 'Current' : 'Show'}</button>}</div>)}
    </div>}
  </div>, owner.element);
}
