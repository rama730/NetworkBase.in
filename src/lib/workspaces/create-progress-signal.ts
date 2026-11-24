'use client';

import { useSyncExternalStore } from 'react';

/** Where the create wizard is, for the top bar's New workspace cell (create wizard v6.8). One wizard per page. */
export type CreateSignal = { step: number; label: string; state: 'editing' | 'creating' | 'done' };

let current: CreateSignal | null = null;
const listeners = new Set<() => void>();
const FOCUS_EVENT = 'nb-create-focus-step';

export function setCreateSignal(next: CreateSignal | null) {
    if (current?.step === next?.step && current?.state === next?.state && current?.label === next?.label) return;
    current = next;
    for (const listener of listeners) listener();
}

export function useCreateSignal(): CreateSignal | null {
    return useSyncExternalStore(
        (notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; },
        () => current,
        () => null,
    );
}

/** The top bar's cell, pressed again: the wizard brings its current step into view (never starts over). */
export function requestCreateStepFocus() {
    window.dispatchEvent(new Event(FOCUS_EVENT));
}

export function onCreateStepFocusRequest(handler: () => void) {
    window.addEventListener(FOCUS_EVENT, handler);
    return () => window.removeEventListener(FOCUS_EVENT, handler);
}
