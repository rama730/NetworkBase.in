export const APP_BEFORE_NAVIGATE_EVENT = 'app:before-navigation';

/** Programmatic navigation gets the same leave check as ordinary links. */
export function confirmAppNavigation(): boolean {
    return typeof window === 'undefined' || window.dispatchEvent(new Event(APP_BEFORE_NAVIGATE_EVENT, { cancelable: true }));
}
