// Ids (a conversation, a task) never show in the top bar's path: the place does.
const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-z_-]{24,})$/i;

/** The mono path for a page (shell redesign): up to two parts of the address, without ids (`workspaces/alpha-app`). */
export function shellPathFor(pathname: string): string {
    const parts = pathname.split("/").filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } }).filter((part) => !ID.test(part));
    return parts.slice(0, 2).join("/") || "discover";
}
