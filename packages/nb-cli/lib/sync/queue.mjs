// Pushes made while offline (report A12.4): saved in .networkbase/queue.json and sent in order by the next
// `nb sync`. Each entry keeps its id, which seeds the idempotency keys, and the base versions stay in state.json,
// so a change someone made meanwhile comes back as a conflict, never an overwrite.
import path from "node:path";

import { DIR_NAME, readJson, writeAtomic } from "../config.mjs";

export const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @typedef {{ id: string, op: "push", paths: string[], flags: Record<string, any>, queuedAt: string, reason?: string, branch?: { id: string, name: string } | null }} QueueEntry */

/** @param {string} root */
const file = (root) => path.join(root, DIR_NAME, "queue.json");

/** @param {string} root @returns {QueueEntry[]} */
export function readQueue(root) {
  const data = readJson(file(root));
  return Array.isArray(data?.entries) ? data.entries : [];
}

/** @param {string} root @param {QueueEntry[]} entries */
export function writeQueue(root, entries) {
  writeAtomic(file(root), `${JSON.stringify({ version: 1, entries })}\n`);
}

/** @param {string} root @param {QueueEntry} entry */
export function enqueue(root, entry) {
  const entries = readQueue(root).filter((e) => e.id !== entry.id);
  writeQueue(root, [...entries, entry]);
  return entries.length + 1;
}
