export const CREATE_WORKSPACE_PATH = '/workspaces/new';

const RETURN_PATH_STORAGE_KEY = 'nb:create-project:return-to';

/** Only same-origin app paths outside the wizard are valid places to return to. */
function isReturnPath(path: string | null | undefined): path is string {
    return typeof path === 'string'
        && path.startsWith('/')
        && !path.startsWith('//')
        && path.split('?')[0] !== CREATE_WORKSPACE_PATH;
}

export function rememberCreateWorkspaceReturnPath(path: string): void {
    if (!isReturnPath(path)) return;
    try {
        window.sessionStorage.setItem(RETURN_PATH_STORAGE_KEY, path);
    } catch {
        // Storage blocked: closing falls back to Discover.
    }
}

export function readCreateWorkspaceReturnPath(): string | null {
    try {
        const path = window.sessionStorage.getItem(RETURN_PATH_STORAGE_KEY);
        return isReturnPath(path) ? path : null;
    } catch {
        return null;
    }
}

export function clearCreateWorkspaceReturnPath(): void {
    try {
        window.sessionStorage.removeItem(RETURN_PATH_STORAGE_KEY);
    } catch {
        // Nothing to clear.
    }
}
