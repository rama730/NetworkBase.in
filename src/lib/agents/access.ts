/**
 * Agent access in one place (report Part A: A2 presets, A6 #5 and A10). The approval page, Settings, /api/v1/me,
 * the MCP access card and the CLI all read the same sentence from here, so the person and the agent see the same
 * words. Big changes still wait for the person's yes whatever the preset (agentGate); the extras only let the agent ask.
 */
import { AGENT_BASE_SCOPES, AGENT_EXTRA_SCOPES, type TokenScope } from "@/lib/security/token-access";

export type AgentPreset = "full" | "small" | "read" | "custom";
export const AGENT_PRESETS = ["full", "small", "read", "custom"] as const;

const READ_SCOPES: TokenScope[] = ["workspace:read", "task:read", "file:read"];

export function scopesForPreset(preset: AgentPreset, extras: TokenScope[] = []): TokenScope[] {
  if (preset === "read") return [...READ_SCOPES];
  if (preset === "full") return [...AGENT_BASE_SCOPES, ...AGENT_EXTRA_SCOPES];
  if (preset === "small") return [...AGENT_BASE_SCOPES];
  return [...AGENT_BASE_SCOPES, ...extras.filter((s) => AGENT_EXTRA_SCOPES.includes(s))];
}

/** Which preset a stored scope list is. An empty list is "base" for agent tokens (effectiveScopes), so Small. */
export function presetOf(scopes: readonly TokenScope[]): AgentPreset {
  if (!scopes.length) return "small";
  const has = new Set(scopes);
  if (!has.has("task:write") && !has.has("file:write")) return "read";
  const extras = AGENT_EXTRA_SCOPES.filter((s) => has.has(s));
  if (extras.length === AGENT_EXTRA_SCOPES.length) return "full";
  return extras.length === 0 ? "small" : "custom";
}

const EXTRA_WORDS: Record<string, { asks: string; cant: string }> = {
  "task:complete": { asks: "finishing tasks", cant: "finish tasks" },
  "file:final": { asks: "final files", cant: "change final files" },
  "doc:write": { asks: "doc edits", cant: "edit docs" },
};

const list = (words: string[], last = "or") => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} ${last} ${words.at(-1)}`);

export function describeAgentAccess(input: {
  agentName: string;
  /** null = all the person's workspaces. */
  workspaceTitle: string | null;
  scopes: readonly TokenScope[];
  expiresAt: Date;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const name = input.agentName.trim() || "This agent";
  if (input.expiresAt <= now) return `${name}'s access has ended. Renew it in Settings → Integrations.`;
  const days = Math.max(1, Math.ceil((input.expiresAt.getTime() - now.getTime()) / 86_400_000));
  const howLong = `for ${days} day${days === 1 ? "" : "s"}`;
  const where = input.workspaceTitle ? input.workspaceTitle : "all your workspaces";
  const preset = presetOf(input.scopes);
  if (preset === "read") return `${name} can read ${where} ${howLong}. It can't change anything.`;
  const head = `${name} can work in ${where} ${howLong}.`;
  if (preset === "full") return `${head} It does small things itself (reading, tasks, comments, drafts) and asks you before finishing tasks, final files, doc edits or deleting.`;
  const has = new Set(input.scopes);
  const allowed = AGENT_EXTRA_SCOPES.filter((s) => has.has(s));
  const missing = AGENT_EXTRA_SCOPES.filter((s) => !has.has(s));
  if (!allowed.length) return `${head} It does small things itself and can't ${list(missing.map((s) => EXTRA_WORDS[s]!.cant))}.`;
  return `${head} It does small things itself and asks you before ${list([...allowed.map((s) => EXTRA_WORDS[s]!.asks), "deleting"])}; it can't ${list(missing.map((s) => EXTRA_WORDS[s]!.cant))}.`;
}
