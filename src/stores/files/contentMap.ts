/**
 * Phase 5 Optimization: Detached Content Map
 * 
 * Purpose: Stores raw file content strings OUTSIDE of Zustand/React state.
 * React's reconciliation engine no longer diffs 10MB text strings on every
 * keystroke. The Zustand store tracks only a lightweight `contentVersion`
 * counter, and components call `getFileContent()` imperatively.
 * 
 * Why a vanilla Map instead of Zustand:
 * - React.memo / useSyncExternalStore run shallow-equality checks on every
 *   subscriber. If a 500KB string lives in the store, that check runs on
 *   EVERY state mutation across the entire workspace.
 * - A plain Map is O(1) get/set with zero framework overhead.
 * 
 * Thread Safety: This runs on the main thread only. Web Workers have their
 * own memory space, so there is no cross-thread contention.
 */

// Composite key: `${projectId}::${nodeId}`
// ponytail: 25MB and 50-file cache ceiling with LRU eviction. ceiling: 25MB total or 50 files. upgrade: IndexedDB binary chunk streaming for files >25MB.
const MAX_CONTENT_MAP_FILES = 50;
const MAX_CONTENT_MAP_BYTES = 25 * 1024 * 1024; // 25MB strict memory ceiling
let _totalContentBytes = 0;
const _contentMap = new Map<string, string>();

/** Build the composite cache key */
export function contentKey(projectId: string, nodeId: string): string {
    return `${projectId}::${nodeId}`;
}

/** Read raw file content from the detached map. Returns "" if not found. */
export function getFileContent(projectId: string, nodeId: string): string {
    const key = contentKey(projectId, nodeId);
    const content = _contentMap.get(key);
    if (content !== undefined) {
        // Refresh LRU access order
        _contentMap.delete(key);
        _contentMap.set(key, content);
        return content;
    }
    return "";
}

/** Write raw file content to the detached map with strict 25MB ceiling enforcement. */
export function setFileContent(
    projectId: string,
    nodeId: string,
    content: string
): void {
    const key = contentKey(projectId, nodeId);
    const existing = _contentMap.get(key);
    if (existing !== undefined) {
        _totalContentBytes -= existing.length * 2;
        _contentMap.delete(key);
    }

    const newBytes = content.length * 2;
    if (newBytes > MAX_CONTENT_MAP_BYTES) {
        // File exceeds the entire cache budget; skip storing to prevent memory ceiling breach
        return;
    }
    // Evict oldest entries until within byte budget and count limit
    while (
        (_contentMap.size >= MAX_CONTENT_MAP_FILES || (_totalContentBytes + newBytes > MAX_CONTENT_MAP_BYTES && _contentMap.size > 0)) &&
        _contentMap.size > 0
    ) {
        const oldestKey = _contentMap.keys().next().value;
        if (!oldestKey) break;
        const oldestContent = _contentMap.get(oldestKey);
        if (oldestContent !== undefined) {
            _totalContentBytes -= oldestContent.length * 2;
        }
        _contentMap.delete(oldestKey);
    }

    _contentMap.set(key, content);
    _totalContentBytes += newBytes;
}

/** Delete a single file's content from the detached map. */
export function deleteFileContent(
    projectId: string,
    nodeId: string
): void {
    const key = contentKey(projectId, nodeId);
    const existing = _contentMap.get(key);
    if (existing !== undefined) {
        _totalContentBytes = Math.max(0, _totalContentBytes - existing.length * 2);
        _contentMap.delete(key);
    }
}

/** Evict all content entries for a given project. */
export function clearProjectContent(projectId: string): void {
    const prefix = `${projectId}::`;
    for (const [key, val] of _contentMap.entries()) {
        if (key.startsWith(prefix)) {
            _totalContentBytes = Math.max(0, _totalContentBytes - val.length * 2);
            _contentMap.delete(key);
        }
    }
    _totalContentBytes = Math.max(0, _totalContentBytes);
}

/** Current number of cached content entries (for diagnostics). */
export function contentMapSize(): number {
    return _contentMap.size;
}

// ---------------------------------------------------------------------------
// FW4: Dirty content crash insurance via IndexedDB
// Persists unsaved content so it survives browser crashes / tab kills.
// ---------------------------------------------------------------------------

const DIRTY_IDB_PREFIX = 'nb-s3-dirty-';

async function openDirtyDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('nb-s3-dirty-content', 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('dirty')) {
                db.createObjectStore('dirty');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Persist dirty content to IndexedDB for crash recovery. */
export async function persistDirtyContent(
    projectId: string,
    nodeId: string,
    content: string,
): Promise<void> {
    try {
        const db = await openDirtyDb();
        const tx = db.transaction('dirty', 'readwrite');
        tx.objectStore('dirty').put(
            { content, savedAt: Date.now() },
            `${DIRTY_IDB_PREFIX}${projectId}::${nodeId}`,
        );
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch {
        // Best-effort — don't block main flow
    }
}

/** Remove dirty content from IDB after successful save. */
export async function clearDirtyContent(
    projectId: string,
    nodeId: string,
): Promise<void> {
    try {
        const db = await openDirtyDb();
        const tx = db.transaction('dirty', 'readwrite');
        tx.objectStore('dirty').delete(`${DIRTY_IDB_PREFIX}${projectId}::${nodeId}`);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch {
        // Best-effort
    }
}

/** Recover all dirty content entries for a project. */
export async function recoverDirtyContent(
    projectId: string,
): Promise<Array<{ nodeId: string; content: string; savedAt: number }>> {
    try {
        const db = await openDirtyDb();
        const tx = db.transaction('dirty', 'readonly');
        const store = tx.objectStore('dirty');
        const prefix = `${DIRTY_IDB_PREFIX}${projectId}::`;

        return new Promise((resolve, reject) => {
            const results: Array<{ nodeId: string; content: string; savedAt: number }> = [];
            const request = store.openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    db.close();
                    resolve(results);
                    return;
                }
                const key = cursor.key as string;
                if (key.startsWith(prefix)) {
                    const nodeId = key.slice(prefix.length);
                    const value = cursor.value as { content: string; savedAt: number };
                    results.push({ nodeId, content: value.content, savedAt: value.savedAt });
                }
                cursor.continue();
            };
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
        });
    } catch {
        return [];
    }
}
