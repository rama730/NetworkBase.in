const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

/** Shared parse for boolean env flags: 1, true, yes, on (any case). */
export function isEnabledFlag(value: string | undefined) {
  return ENABLED_VALUES.has(value?.trim().toLowerCase() ?? "");
}

/**
 * Private Broadcast/Presence must not start until the matching
 * `realtime.messages` policies have been applied and verified in Supabase.
 * The default is deliberately fail-closed: every live channel stays off and
 * screens show data as of their last read.
 */
let warnedOff = false;

export function isPrivateRealtimeAuthorizationEnabled() {
  const enabled = isEnabledFlag(process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED);
  if (!enabled && !warnedOff && process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    warnedOff = true;
    console.warn("[realtime] off: typing and live presence are disabled. Set NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED=1 in .env.local and restart.");
  }
  return enabled;
}
