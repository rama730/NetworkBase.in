/**
 * The first-load window: open while a page first opens (and always in server HTML), closed for good after `ms`.
 * No-photo avatars draw themselves in only inside it; anything that appears later is drawn still.
 */
export function createFirstLoadWindow(ms: number, isClient: boolean) {
    let open = isClient
    const listeners = new Set<() => void>()
    if (isClient) setTimeout(() => { open = false; listeners.forEach((listener) => listener()) }, ms)
    return {
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
        getSnapshot: () => open,
        getServerSnapshot: () => true,
    }
}

/** One window per page load: the draw-in (0.18s + cells, about 0.8s) has finished well before it closes. */
export const firstLoadWindow = createFirstLoadWindow(1400, typeof window !== 'undefined')
