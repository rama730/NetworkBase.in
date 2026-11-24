/** Get started (create wizard v6): the new workspace's next steps, shown after Create and on its Overview until done
 *  or hidden. Per browser (localStorage), like other "dismissed" notes; nothing here needs to follow the person around. */
export type GetStartedTask = 'partial' | 'invite' | 'share' | 'doc' | 'files' | 'update';
export type GetStartedState = {
    hidden: boolean;
    done: GetStartedTask[];
    tasks: GetStartedTask[];
    /** A step Create didn't finish ("Open anyway"), or an import still running ("Open now"). */
    partial?: { key: string; label: string; at?: number; total?: number; importing?: boolean };
    /** The first open role's title, for "Share the {role} opening". */
    role?: string;
};

const EMPTY: GetStartedState = { hidden: false, done: [], tasks: [] };
const storageKey = (projectId: string) => `nb-get-started:${projectId}`;

export function readGetStarted(projectId: string): GetStartedState {
    try {
        const raw = window.localStorage.getItem(storageKey(projectId));
        return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<GetStartedState>) } : { ...EMPTY };
    } catch {
        return { ...EMPTY };
    }
}

export function writeGetStarted(projectId: string, patch: Partial<GetStartedState>): GetStartedState {
    const next = { ...readGetStarted(projectId), ...patch };
    try {
        window.localStorage.setItem(storageKey(projectId), JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('nb-get-started', { detail: projectId }));
    } catch { /* private mode: the list just won't remember */ }
    return next;
}

/** Left to do: every task not done yet. */
export function openTasks(state: GetStartedState): GetStartedTask[] {
    return state.tasks.filter((task) => !state.done.includes(task));
}
