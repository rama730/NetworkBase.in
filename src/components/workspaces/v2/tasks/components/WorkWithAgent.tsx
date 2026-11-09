"use client";

import { useState } from "react";
import Link from "next/link";

import { TerminalBlock } from "@/components/ui/terminal-block";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";

type Tab = "claude" | "codex" | "terminal";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [{ key: "claude", label: "Claude Code" }, { key: "codex", label: "Codex" }, { key: "terminal", label: "Terminal" }];

/**
 * "Work with an agent" on a task (report A9.6): how to link a folder to this task and start Claude Code or Codex on
 * it, with a starter request. The agent gets its own sign-in limited to this workspace; big changes wait for a yes.
 */
export function WorkWithAgent({ projectSlug, taskNumber, canEdit }: { projectSlug: string | null | undefined; taskNumber: number | null | undefined; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("claude");
  if (!projectSlug || !taskNumber) return null;
  const init = `$ npx @networkbase/cli init ${projectSlug} --task ${taskNumber}`;
  const commands: Record<Tab, string> = {
    claude: `${init}\n$ nb agent setup claude\n$ claude`,
    codex: `${init}\n$ nb agent setup codex\n$ codex`,
    terminal: canEdit ? `${init}\n$ nb task view ${taskNumber}\n$ nb push <files> --task ${taskNumber}\n$ nb task done ${taskNumber} -m "what you did"` : `${init}\n$ nb pull`,
  };
  const prompt = `Work on task #${taskNumber}: read it with the networkbase tools, ask me anything unclear, push drafts as you go, and tell me before you finish it.`;
  return (
    <details className="group border-t border-border pt-3">
      <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">Work with an agent</summary>
      <div className="space-y-3 pt-3">
        <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} label="Agent" idPrefix={`agent-${taskNumber}`} />
        <div id={`agent-${taskNumber}-panel-${tab}`} role="tabpanel" aria-labelledby={`agent-${taskNumber}-tab-${tab}`} className="space-y-3">
          <TerminalBlock variant="command" label="Terminal" wrap>{commands[tab]}</TerminalBlock>
          {tab !== "terminal" ? <TerminalBlock variant="code" label="Then ask" wrap>{prompt}</TerminalBlock> : null}
          <p className="text-[12px] leading-snug text-muted-foreground">
            The agent signs in with its own token, limited to this workspace. Its changes show “via {tab === "codex" ? "Codex" : "Claude Code"}”; finishing the task, final files and deleting wait for your yes. <Link href="/docs/agents" className="nb-link">How it works</Link>
          </p>
        </div>
      </div>
    </details>
  );
}
