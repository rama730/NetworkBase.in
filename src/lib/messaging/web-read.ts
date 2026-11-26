/**
 * Read a conversation through /api/v1/chat/web (parallel GETs) instead of a server action (one at a time).
 * Answers in the server action's own shape, so callers don't change.
 */
export async function chatGet<T>(fn: "channel" | "messages", params: Record<string, string | number | undefined>): Promise<T> {
  const query = new URLSearchParams({ fn });
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  try {
    const response = await fetch(`/api/v1/chat/web?${query}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return { success: false, error: response.status === 401 ? "chat_unauthorized" : "chat_network" } as T;
    return (await response.json()) as T;
  } catch {
    return { success: false, error: "chat_network" } as T;
  }
}
