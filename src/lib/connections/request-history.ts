/** The states a connection request shows in history, and how long its accepted banner stays up. */
export const CONNECTION_REQUEST_HISTORY_STATUSES = [
    'pending',
    'accepted',
    'rejected',
    'cancelled',
    'disconnected',
] as const;
export type ConnectionRequestHistoryStatus = (typeof CONNECTION_REQUEST_HISTORY_STATUSES)[number];

export const CONNECTION_BANNER_HIDE_AFTER_MS = 5 * 60 * 1000;
