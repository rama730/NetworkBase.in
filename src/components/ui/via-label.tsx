import { Bot, Terminal } from "lucide-react";

/**
 * "via Claude Code" / "via CLI" next to an author (report A9.7): one label wherever a change made through an agent or
 * the CLI is shown. Nothing for changes made in the app.
 */
export function ViaLabel({ via, agentName, className }: { via?: string | null; agentName?: string | null; className?: string }) {
  if (via !== "agent" && via !== "cli") return null;
  const Icon = via === "agent" ? Bot : Terminal;
  const words = via === "agent" ? `via ${agentName?.trim() || "an AI agent"}` : "via CLI";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground ${className ?? ""}`} title={via === "agent" ? `Made by ${agentName?.trim() || "an AI agent"} for this person` : "Made from the NetworkBase CLI"}>
      <Icon className="size-3" aria-hidden="true" strokeWidth={1.75} />
      {words}
    </span>
  );
}
