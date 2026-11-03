export const APP_BEFORE_NAVIGATE_EVENT = 'app:before-navigation';

export type AppBeforeNavigateEvent = CustomEvent<{ go: () => void }>;

/**
 * Programmatic navigation gets the same leave check as ordinary links. `go` runs now when nothing objects; a page
 * holding unsaved work cancels the event, asks in the shared dialog, and runs `go` itself if the person leaves.
 */
export function confirmAppNavigation(go: () => void) {
    if (typeof window === 'undefined' || window.dispatchEvent(new CustomEvent(APP_BEFORE_NAVIGATE_EVENT, { cancelable: true, detail: { go } }))) go();
}
