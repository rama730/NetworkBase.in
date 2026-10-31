import { toast } from '@/lib/feedback';

/** Copy for a download the server refused. The catalog in feedback/copy.ts adds the next step. */
export function downloadFailureMessage(status: number) {
    if (status === 401) return 'Sign in to download';
    if (status === 403) return 'You don’t have access to this';
    if (status === 404 || status === 410) return 'This file is no longer available';
    if (status === 409) return 'This download couldn’t be prepared';
    if (status === 413) return 'This download is too large';
    if (status === 422) return 'There’s nothing to download here';
    if (status === 429) return 'Too many downloads';
    return 'Download failed';
}

/** Only a wait long enough to be worth saying: short ones read better as "wait a minute". */
export function retryMessage(headers: Headers) {
    const seconds = Number(headers.get('retry-after'));
    return seconds > 120 ? `Try again in ${Math.ceil(seconds / 60)} minutes` : null;
}

/** A zip that had to leave files out says so, or people would assume they got everything. */
export function skippedMessage(headers: Headers) {
    const count = Number(headers.get('x-download-skipped'));
    if (!count) return null;
    return count === 1 ? 'One file wasn’t included' : `${count} files weren’t included`;
}

function clickLink(href: string, filename?: string) {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename ?? '';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/** The same URL asking for an attachment. Anything not served by this app (a local preview) is left alone. */
function downloadUrl(url: string) {
    const parsed = new URL(url, window.location.origin);
    // A blob: URL reports this page's origin, but it's a file in memory, not a route.
    if (parsed.origin !== window.location.origin || parsed.protocol === 'blob:') return null;
    parsed.searchParams.set('download', '1');
    return parsed.pathname + parsed.search;
}

/** A workspace file's route, or one of its old versions. Access is checked when it is requested. */
export function workspaceFileUrl(projectId: string, nodeId: string, revision?: number) {
    const base = `/api/v1/workspaces/${encodeURIComponent(projectId)}/files/${encodeURIComponent(nodeId)}/preview`;
    return revision == null ? base : `${base}?revision=${revision}`;
}

/** A zip of a whole workspace, one folder, or chosen items. */
export function workspaceExportUrl(projectId: string, name: string, selection: { folderId: string } | { ids: string[] } | null = null) {
    const params = new URLSearchParams({ name });
    if (selection && 'folderId' in selection) params.set('folderId', selection.folderId);
    if (selection && 'ids' in selection) params.set('ids', selection.ids.join(','));
    return `/api/v1/workspaces/${encodeURIComponent(projectId)}/files/export?${params.toString()}`;
}

// A second click while the first is still being checked is the same download.
const checking = new Set<string>();

/**
 * Every server download in the app. It checks first because a link click can't see a failure: the browser would
 * save the error as the file, or leave the page. Then the browser takes over, with its own progress and resume.
 */
export async function downloadFile(url: string, options: { filename?: string } = {}) {
    const target = downloadUrl(url);
    if (!target) {
        clickLink(url, options.filename);
        return true;
    }
    if (checking.has(target)) return false;
    checking.add(target);
    let status: number;
    let retry: string | null = null;
    let skipped: string | null = null;
    try {
        const response = await fetch(target, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
        status = response.status;
        retry = retryMessage(response.headers);
        skipped = skippedMessage(response.headers);
    } catch {
        toast.error('Download failed');
        return false;
    } finally {
        checking.delete(target);
    }
    if (status < 200 || status >= 300) {
        toast.error((status === 429 && retry) || downloadFailureMessage(status));
        return false;
    }
    clickLink(target, options.filename);
    if (skipped) toast.warning(skipped);
    return true;
}

/** Saves a file made in the browser. Safari and Firefox can lose the file if its URL goes away right after the click. */
export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    clickLink(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** One CSV cell. A leading = + - @ would run as a formula in a spreadsheet, so it is kept as text. */
export function csvCell(value: unknown) {
    const text = String(value ?? '');
    return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}

/** The byte order mark tells Excel the file is UTF-8, so names and notes in any language read correctly. */
export function toCsvBlob(rows: unknown[][]) {
    return new Blob(['\uFEFF', rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
}
