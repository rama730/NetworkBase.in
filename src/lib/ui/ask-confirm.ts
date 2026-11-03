// One question at a time in the shared dialog (report §32.3, decision 75), for code that isn't a component: file
// navigation guards, upload checks. `SharedConfirmHost` (mounted once with the app's providers) shows it.

export type ConfirmQuestion = { title: string; description?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean };
type Pending = ConfirmQuestion & { answer: (ok: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Resolves true on confirm, false on cancel. A new question cancels one still waiting. */
export function askConfirm(question: ConfirmQuestion): Promise<boolean> {
  pending?.answer(false);
  return new Promise((resolve) => {
    const asked: Pending = { ...question, answer: (ok) => { if (pending === asked) { pending = null; changed(); } resolve(ok); } };
    pending = asked;
    changed();
  });
}

export const confirmStore = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  current: () => pending,
};
