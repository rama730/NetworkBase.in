import { toast } from '@/lib/feedback';

/** Copy for a download the server refused. The catalog in feedback/copy.ts adds the next step. */
export function downloadFailureMessage(status: number) {
    if (status === 401) return 'Sign in to download';
    if (status === 403) return 'You don’t have access to this';
    if (status === 404 || status === 410) return 'This file is no longer available';
    if (status === 413) return 'This download is too large';
    if (status === 429) return 'Too many downloads';
    return 'Download failed';
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
export function downloadUrl(url: string) {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    parsed.searchParams.set('download', '1');
    return parsed.pathname + parsed.search;
}

/** A workspace file's route, or one of its old versions. Access is checked when it is requested. */
export function workspaceFileUrl(projectId: string, nodeId: string, revision?: number) {
    const base = `/api/v1/workspaces/${encodeURIComponent(projectId)}/files/${encodeURIComponent(nodeId)}/preview`;
    return revision == null ? base : `${base}?revision=${revision}`;
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
    try {
        status = (await fetch(target, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })).status;
    } catch {
        toast.error('Download failed');
        return false;
    } finally {
        checking.delete(target);
    }
    if (status < 200 || status >= 300) {
        toast.error(downloadFailureMessage(status));
        return false;
    }
    clickLink(target, options.filename);
    return true;
}

/** Saves a file made in the browser. Safari and Firefox can lose the file if its URL goes away right after the click. */
export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    clickLink(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
