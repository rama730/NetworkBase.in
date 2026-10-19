import type { CreateProjectInput } from '@/lib/validations/project';

const GITHUB_OAUTH_RESUME_STORAGE_KEY = 'create-project:github-oauth-resume:v1';
const GITHUB_OAUTH_RESUME_MAX_AGE_MS = 5 * 60 * 1000;

export type CreateProjectGithubOAuthResume = {
    id: string;
    startedAt: number;
    returnPath: string;
    values: CreateProjectInput;
};

export type CreateProjectSource = 'scratch' | 'github' | 'upload';

export function parseCreateProjectSource(raw: string | null | undefined): CreateProjectSource | null {
    return raw === 'github' || raw === 'upload' || raw === 'scratch' ? raw : null;
}

export function getCreateProjectReturnPath(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete('createProject');
    searchParams.delete('createProjectSource');
    searchParams.delete('githubIdentity');
    searchParams.delete('error');
    searchParams.delete('error_description');
    const search = searchParams.toString();
    return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
}

function isFresh(resume: CreateProjectGithubOAuthResume): boolean {
    return Number.isFinite(resume.startedAt) && Date.now() - resume.startedAt <= GITHUB_OAUTH_RESUME_MAX_AGE_MS;
}

function readStoredResume(): CreateProjectGithubOAuthResume | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem(GITHUB_OAUTH_RESUME_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<CreateProjectGithubOAuthResume>;
        if (
            typeof parsed.id !== 'string'
            || typeof parsed.returnPath !== 'string'
            || !parsed.values
            || typeof parsed.startedAt !== 'number'
        ) {
            window.sessionStorage.removeItem(GITHUB_OAUTH_RESUME_STORAGE_KEY);
            return null;
        }
        const resume = parsed as CreateProjectGithubOAuthResume;
        if (!isFresh(resume)) {
            window.sessionStorage.removeItem(GITHUB_OAUTH_RESUME_STORAGE_KEY);
            return null;
        }
        return resume;
    } catch {
        return null;
    }
}

export function saveGithubOAuthResume(values: CreateProjectInput, returnPath: string): CreateProjectGithubOAuthResume | null {
    if (typeof window === 'undefined') return null;
    try {
        // GitHub authorization is a source-only flow. FileList uploads are never part
        // of this form snapshot, so resuming does not claim to retain local files.
        const copiedValues = JSON.parse(JSON.stringify(values)) as CreateProjectInput;
        const resume: CreateProjectGithubOAuthResume = {
            id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `github-oauth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            startedAt: Date.now(),
            returnPath,
            values: copiedValues,
        };
        window.sessionStorage.setItem(GITHUB_OAUTH_RESUME_STORAGE_KEY, JSON.stringify(resume));
        return resume;
    } catch {
        return null;
    }
}

export function readGithubOAuthResume(returnPath: string): CreateProjectGithubOAuthResume | null {
    const resume = readStoredResume();
    return resume?.returnPath === returnPath ? resume : null;
}

export function clearGithubOAuthResume(resumeId?: string): void {
    if (typeof window === 'undefined') return;
    try {
        if (resumeId) {
            const current = readStoredResume();
            if (current?.id && current.id !== resumeId) return;
        }
        window.sessionStorage.removeItem(GITHUB_OAUTH_RESUME_STORAGE_KEY);
    } catch {
        // Storage failures must never block an authorized import.
    }
}
