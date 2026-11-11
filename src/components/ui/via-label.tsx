/**
 * "Ram · with Claude Code" (report Part B): small muted text after an author, like "edited on iPhone". The person
 * is the author; the agent or the CLI is the tool they used. Nothing for changes made in the app, or when the server
 * decided this viewer doesn't see it (src/lib/agents/via-visibility).
 */
export function ViaLabel({ via, agentName, className }: { via?: string | null; agentName?: string | null; className?: string }) {
  if (via !== "agent" && via !== "cli") return null;
  const words = via === "agent" ? `with ${agentName?.trim() || "an AI agent"}` : "with the CLI";
  return (
    <span className={`whitespace-nowrap text-[11px] text-muted-foreground ${className ?? ""}`}>
      <span aria-hidden="true">· </span>
      {words}
    </span>
  );
}
