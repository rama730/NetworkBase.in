/** One set of words for connection states, used by the Discover rail and the Network page alike. */
export const CONNECTION_COPY = {
    connect: "Connect",
    requested: "Requested",
    review: "Review request",
    connected: "Connected",
    notAccepting: "Not accepting requests",
    blocked: "Blocked",
    sending: "Sending request…",
    sendFailed: "Failed to send request",
    nameFallback: "Member",
    blocking: "Blocking…",
    blockFailed: "Failed to block",
    blocked_toast: (name: string) => `Blocked ${name}`,
    shared: (count: number) => `${count} shared ${count === 1 ? "connection" : "connections"}`,
} as const;
