/** A page the browser restored from memory (back/forward cache) after sign-out must not stay on screen. */
export function shouldEjectRestoredPage(persisted: boolean, hasSession: boolean): boolean {
    return persisted && !hasSession;
}
