import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Server-only: run a function as a given person, for jobs that act on someone's behalf at a set time (report 38.17
 * call 3: a scheduled Update posts with its author's rights at the time). Nothing a browser or token sends can set
 * this; only server code that already holds the person's id (from a row they made) calls it. The viewer context
 * reads it first, so the usual action runs with all of its own checks.
 */
const store = new AsyncLocalStorage<{ userId: string }>();

export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ userId }, fn);
}

export const actingAsUserId = (): string | null => store.getStore()?.userId ?? null;
