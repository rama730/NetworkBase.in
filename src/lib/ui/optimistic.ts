/** Controls round 2, instant toggles: what a save's result means. `null` is saved; a string is why it wasn't. */
export async function saveOutcome(result: Promise<unknown>): Promise<string | null> {
  const fallback = "Couldn’t save that. Check your connection.";
  try {
    const value = await result;
    if (value && typeof value === "object" && "success" in value && (value as { success: unknown }).success === false) {
      const error = (value as { error?: unknown }).error;
      return typeof error === "string" && error ? error : fallback;
    }
    return null;
  } catch (error) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
