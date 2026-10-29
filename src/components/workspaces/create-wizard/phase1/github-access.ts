export function isGithubAccessRefreshError(message: string | null | undefined) {
    const normalized = (message || '').toLowerCase();
    if (!normalized) return false;
    return (
        normalized.includes('repository access is not available') ||
        normalized.includes('unauthorized') ||
        normalized.includes('connect github') ||
        normalized.includes('sign in to github') ||
        normalized.includes('private. connect github')
    );
}
