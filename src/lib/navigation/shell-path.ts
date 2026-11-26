// Ids (a conversation, a task) never show in the top bar's path: the place does. A long token without hyphens is an id;
// a slug always has them (`team-falcon-hash-table-library-oxao5`).
const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-z_]{24,})$/i;

/** The mono path for a page (shell redesign): up to two parts of the address, without ids (`workspaces/alpha-app`). */
export function shellPathFor(pathname: string): string {
    const parts = pathname.split("/").filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } })
        // `/messages/w/<workspace>/…`: the w only marks the workspace id that follows.
        .filter((part, index, all) => !ID.test(part) && !(part === "w" && all[index - 1] === "messages"));
    return parts.slice(0, 2).join("/") || "discover";
}

const PLACE = /^\/(workspaces|org)\/(?!new(?:\/|$))[^/]+/;

/** A workspace or organization page (not /workspaces/new). */
export const isPlacePath = (pathname: string) => PLACE.test(pathname);

/**
 * The path's parts, with a place's address swapped for its real name (`workspaces / Network for builders`). Until the
 * name is known only `workspaces` shows, so the dashed address never flashes before the name types in.
 */
export function shellPartsFor(pathname: string, name: string | null | undefined): string[] {
    const parts = shellPathFor(pathname).split("/");
    if (!isPlacePath(pathname)) return parts;
    const shown = name?.trim();
    return shown ? [parts[0]!, shown] : [parts[0]!];
}
