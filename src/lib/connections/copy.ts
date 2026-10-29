/** One set of words for connection states, used by the Discover rail and the Network page alike. */
export const CONNECTION_COPY = {
    connect: "Connect",
    requested: "Requested",
    review: "Review request",
    connected: "Connected",
    notAccepting: "Not accepting requests",
    blocked: "Blocked",
    sending: "Sending request…",
    sendFailed: "Request wasn’t sent",
    nameFallback: "Member",
    blocking: "Blocking…",
    blockFailed: "Person wasn’t blocked",
    blocked_toast: (name: string) => `Blocked ${name}`,
    shared: (count: number) => `${count} mutual ${count === 1 ? "connection" : "connections"}`,
} as const;
