/** A GitHub import's file progress as the Files banner and the Creating screen read it. The import itself writes
 *  `stored` (import-hydration.ts) and ends on done, incomplete or failed; `completed` is kept for older records. */
export function hydrationProgress(hydration: unknown): { status: string; completed: number; total: number } | null {
    if (!hydration || typeof hydration !== 'object') return null;
    const h = hydration as { status?: unknown; stored?: unknown; completed?: unknown; total?: unknown };
    if (typeof h.status !== 'string') return null;
    return { status: h.status, completed: Number(h.stored ?? h.completed) || 0, total: Number(h.total) || 0 };
}
