"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { createPersonalAccessToken, listTokenWorkspaces, type PersonalAccessTokenSummary } from "@/app/actions/personal-access-tokens";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { TerminalBlock } from "@/components/ui/terminal-block";
import { toast } from "@/lib/feedback";

/** What each permission lets a token do, in words (report A3.6, A9.5). Reading is always on. */
export const SCOPE_WORDS: Array<{ scopes: string[]; label: string; hint: string; preset?: boolean }> = [
  { scopes: ["workspace:read", "task:read", "file:read"], label: "Read workspaces, tasks and files", hint: "Always on", preset: true },
  { scopes: ["file:write"], label: "Push files as drafts", hint: "New files and new versions", preset: true },
  { scopes: ["task:write"], label: "Create and change tasks", hint: "Titles, subtasks, comments, status", preset: true },
  { scopes: ["task:complete"], label: "Finish tasks", hint: "Mark done or send for review" },
  { scopes: ["file:final"], label: "Mark files final", hint: "Final files and hand-ins" },
  { scopes: ["file:delete"], label: "Delete files", hint: "Moves them to the workspace Trash" },
  { scopes: ["doc:write"], label: "Edit docs", hint: "The README and other docs" },
  { scopes: ["ask:others"], label: "Ask other people", hint: "Questions to the assignee or reviewer" },
  { scopes: ["assignment:hand-in"], label: "Hand in assignments", hint: "Your own copies, with the app's late rules" },
  { scopes: ["task:review"], label: "Review hand-ins", hint: "Approve or return, for organization reviewers" },
];

/** Old and new permission names → the words above, for the token list. */
export function scopeWords(scopes: string[]) {
  const legacy: Record<string, string> = { "repo:read": "read", "repo:write": "push and delete files", "task:write": "change and finish tasks", "sprint:manage": "change tasks" };
  if (scopes.some((s) => s in legacy)) return scopes.map((s) => legacy[s] ?? s).join(", ");
  return SCOPE_WORDS.filter((w) => w.scopes.every((s) => scopes.includes(s))).map((w) => w.label.toLowerCase()).join(", ") || "read";
}

const EXPIRY = [{ days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 365, label: "1 year" }];

/** New personal token: permissions, one workspace or all, expiry; shown once, never put into a command. */
export function PersonalTokenForm({ onCreated, onDone }: { onCreated: (token: PersonalAccessTokenSummary) => void; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState(() => new Set(SCOPE_WORDS.filter((w) => w.preset).map((w) => w.label)));
  const [workspaceId, setWorkspaceId] = useState("");
  const [days, setDays] = useState(90);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; title: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => { void listTokenWorkspaces().then(setWorkspaces, () => setWorkspaces([])); }, []);

  const create = async () => {
    setBusy(true);
    try {
      const scopes = SCOPE_WORDS.filter((w) => picked.has(w.label)).flatMap((w) => w.scopes);
      const res = await createPersonalAccessToken({ label: label.trim() || "CLI token", scopes, expiresInDays: days, workspaceId: workspaceId || null });
      if (!res.success) { toast.error(res.error); return; }
      setRaw(res.rawToken);
      onCreated({ ...res.token, workspaceTitle: workspaces.find((w) => w.id === workspaceId)?.title ?? null });
    } finally {
      setBusy(false);
    }
  };

  if (raw) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input type="password" readOnly aria-label="Your new personal access token" value={raw} className="nb-meta font-mono" onFocus={(e) => { e.currentTarget.type = "text"; e.currentTarget.select(); }} onBlur={(e) => { e.currentTarget.type = "password"; }} />
          <CopyButton text={raw} className="shrink-0" />
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => { setRaw(null); onDone(); }}>Done</Button>
        </div>
        <p className="nb-compact text-muted-foreground">Shown once. Paste it when nb asks for it, or set it as NETWORKBASE_TOKEN in CI. Don’t put it in a command: commands are saved in your shell history.</p>
        <TerminalBlock variant="command" label="Terminal">{"$ nb login --with-token"}</TerminalBlock>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xs space-y-1.5">
        <label htmlFor="cli-pat-label" className="nb-ui-label text-foreground">Name</label>
        <Input id="cli-pat-label" type="text" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. GitHub Actions" />
      </div>
      <fieldset className="space-y-2">
        <legend className="nb-ui-label text-foreground">What it can do</legend>
        {SCOPE_WORDS.map((w, i) => (
          <label key={w.label} className="flex items-start gap-2.5 nb-compact">
            <input type="checkbox" className="nb-check mt-0.5" disabled={i === 0} checked={picked.has(w.label)}
              onChange={(e) => setPicked((prev) => { const next = new Set(prev); if (e.target.checked) next.add(w.label); else next.delete(w.label); return next; })} />
            <span><span className="text-foreground">{w.label}</span> <span className="text-muted-foreground">· {w.hint}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="space-y-1.5">
          <span className="nb-ui-label block text-foreground">Workspaces</span>
          <select className="h-9 rounded-md border border-input bg-background px-2 nb-compact" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            <option value="">All my workspaces</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>Only {w.title}</option>)}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="nb-ui-label block text-foreground">Expires after</span>
          <select className="h-9 rounded-md border border-input bg-background px-2 nb-compact" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRY.map((x) => <option key={x.days} value={x.days}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <Button size="sm" onClick={() => void create()} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        Create token
      </Button>
    </div>
  );
}
