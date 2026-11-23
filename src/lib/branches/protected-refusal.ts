/**
 * The database's refusal on a protected main (report H5, 0099 `saves_guard`), found in an error from any writer.
 * Drizzle may wrap the driver's error, so the cause chain is walked. Plain (no server imports), so the route error
 * funnel can use it. Returns null for any other error.
 */
export function protectedRefusal(error: unknown): { message: string; reason: "agents" | "merge_request" } | null {
  for (let e = error as { message?: string; cause?: unknown; hint?: string } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    const message = typeof e.message === "string" ? e.message : "";
    const at = message.indexOf("BRANCH_PROTECTED: ");
    if (at >= 0) {
      const agents = e.hint === "agents" || message.includes("agents work on a branch");
      return { message: message.slice(at + "BRANCH_PROTECTED: ".length).split("\n")[0]!, reason: agents ? "agents" : "merge_request" };
    }
  }
  return null;
}

/** The database's refusal on approved board minutes (A4.9, 0117 `approved_minutes_guard`), from any writer. Null otherwise. */
export function minutesRefusal(error: unknown): string | null {
  for (let e = error as { message?: string; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (typeof e.message === "string" && e.message.includes("MINUTES_APPROVED: ")) return "These minutes are approved and can’t be edited.";
  }
  return null;
}
