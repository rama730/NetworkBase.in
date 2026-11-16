import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { TerminalBlock } from "@/components/ui/terminal-block";
import { ERROR_CATALOG } from "@/lib/api/errors";
import help from "@/lib/cli/commands.json";

// The CLI guide (report A6.8, A9.10). The command reference is generated from the CLI's own command table
// (src/lib/cli/commands.json, kept fresh by tests/unit/api-schemas-fresh), so it always matches `nb help`.

export const metadata: Metadata = {
  title: "NetworkBase CLI",
  description: "Push and pull workspace files, work on tasks and connect AI agents from your terminal.",
};

type Flag = { type: string; describe?: string; short?: string; valueName?: string };
type Command = { name: string; summary: string; usage: string; flags: Record<string, Flag>; examples: string[] };

const flagWords = (name: string, f: Flag) => `--${name}${f.short ? `, -${f.short}` : ""}${f.type === "string" ? ` <${f.valueName ?? "value"}>` : ""}`;

export default function CliDocsPage() {
  const commands = help.commands as unknown as Command[];
  return (
    <LegalDocumentPage
      eyebrow="Docs · Terminal"
      title="NetworkBase CLI"
      summary="Work on NetworkBase from your terminal: link a folder, push and pull files, work on tasks, and connect Claude Code, Codex or Cursor."
      version="2.0"
      sections={[
        {
          id: "start",
          title: "1. Get started",
          content: (
            <>
              <p>Needs Node.js 20 or newer. In your project folder, one command signs you in, links the folder (the workspace named like it comes first) and pulls its files:</p>
              <TerminalBlock variant="command" label="Terminal">{"$ cd my-project\n$ npx @networkbase/cli start"}</TerminalBlock>
              <p>Or step by step, and <code>nb learn</code> for five minutes of practice in a workspace made for it (deleted at the end):</p>
              <TerminalBlock variant="command" label="Terminal">{"$ npx @networkbase/cli login\n$ cd my-project\n$ nb init design-lab\n$ nb push notes.md -m \"First notes\""}</TerminalBlock>
              <p>No browser on this computer (SSH, a container)? <code>nb login --device</code> shows a code to approve on any device. For scripts and CI, set <code>NETWORKBASE_TOKEN</code> or pipe a token into <code>nb login --with-token</code>; never put a token in a command.</p>
            </>
          ),
        },
        {
          id: "install",
          title: "Install",
          content: (
            <>
              <p><code>npm i -g @networkbase/cli</code> installs <code>nb</code>; <code>nb upgrade</code> updates it the same way. <code>npx @networkbase/cli …</code> runs the latest without installing.</p>
              <p>Without Node: a single-file <code>nb</code> for macOS (Apple silicon), Linux and Windows, with Homebrew and Scoop, is on its way. Until it’s published, install Node 22 LTS from nodejs.org.</p>
            </>
          ),
        },
        {
          id: "concepts",
          title: "2. How it works",
          content: (
            <LegalList>
              <li><strong>A folder is a working copy.</strong> <code>nb pull</code> never overwrites your edits: when both changed, the server’s version is saved next to yours and <code>nb resolve</code> settles it.</li>
              <li><strong>Same path, new version.</strong> <code>nb push</code> uploads only the files you name (or <code>--all</code> changed tracked files). A newer version from a teammate stops the push (exit 4).</li>
              <li><strong>Roles.</strong> Files on a task are reference, draft or final: <code>nb push plan.pdf --task 4 --as final</code>.</li>
              <li><strong>Tasks.</strong> Pushing never changes a task’s status. <code>{"nb task done 4 -m \"what you did\""}</code> finishes it, or sends it for review.</li>
              <li><strong>Undo.</strong> <code>nb undo</code> reverses the last change from this computer within 24 hours.</li>
            </LegalList>
          ),
        },
        {
          id: "commands",
          title: "3. Commands",
          content: (
            <div className="space-y-5">
              {commands.map((c) => (
                <div key={c.name} id={`cmd-${c.name.replace(/ /g, "-")}`} className="scroll-mt-24 space-y-2">
                  <p><strong><code>nb {c.name}</code></strong> · {c.summary}</p>
                  <TerminalBlock variant="command" copy={false}>{`$ ${c.usage}`}</TerminalBlock>
                  {Object.keys(c.flags).length ? (
                    <LegalList>{Object.entries(c.flags).map(([name, f]) => <li key={name}><code>{flagWords(name, f)}</code> {f.describe}</li>)}</LegalList>
                  ) : null}
                  {c.examples.length ? <TerminalBlock variant="command" label="Examples">{c.examples.map((e) => `$ ${e}`).join("\n")}</TerminalBlock> : null}
                </div>
              ))}
              <p>Every command also takes {Object.entries(help.globalFlags as Record<string, Flag>).map(([name, f], i) => <span key={name}>{i ? ", " : ""}<code>{flagWords(name, f)}</code></span>)}.</p>
            </div>
          ),
        },
        {
          id: "json",
          title: "4. Scripts and JSON",
          content: (
            <>
              <p><code>--json</code> prints one result on stdout, <code>{"{ ok, schema, data }"}</code>; <code>--fields a,b</code> keeps only those fields of each item. Progress and questions go to stderr. Without a terminal nb never asks: pass <code>--answer key=value</code> or <code>--yes</code>.</p>
              <TerminalBlock variant="command">{"$ nb task list --json --fields number,title,status | jq '.data.tasks[]'"}</TerminalBlock>
            </>
          ),
        },
        {
          id: "exit-codes",
          title: "5. Exit codes",
          content: <LegalList>{[["0", "done"], ["1", "failed"], ["2", "usage: a wrong command or flag"], ["3", "sign-in or access"], ["4", "conflict: someone changed it first"], ["5", "blocked: a secret, a plan limit, read-only"], ["6", "needs an answer (--answer)"], ["7", "needs a yes (--confirm <token>)"], ["8", "offline: the push is queued for the next nb sync"], ["130", "cancelled"]].map(([code, words]) => <li key={code}><code>{code}</code> {words}</li>)}</LegalList>,
        },
        {
          id: "errors",
          title: "6. Errors",
          content: (
            <div className="space-y-2">
              {Object.entries(ERROR_CATALOG).map(([code, e]) => (
                <p key={code} id={`error-${code}`} className="scroll-mt-24"><code>{code}</code> · {e.meaning}. <span className="text-muted-foreground">{e.fix}.</span></p>
              ))}
            </div>
          ),
        },
        {
          id: "env",
          title: "7. Settings and environment",
          content: (
            <LegalList>
              <li><code>NETWORKBASE_TOKEN</code> signs in without a saved token (CI). <code>NETWORKBASE_API_URL</code> or <code>--api-url</code> chooses the server.</li>
              <li><code>NB_HOME</code> moves the settings folder (default <code>~/.networkbase</code>). Tokens are kept in the system keychain when there is one; <code>NB_CREDENTIAL_STORE=file</code> keeps them in the file.</li>
              <li><code>NO_COLOR</code> or <code>--plain</code> turns off color and symbols; <code>NB_PAGER</code> or <code>PAGER</code> chooses the pager (<code>--no-pager</code> skips it).</li>
              <li><code>NB_NO_UPDATE_CHECK=1</code> turns off the daily “new version” note. Behind a proxy: <code>NODE_USE_ENV_PROXY=1</code>; with company certificates: <code>NODE_EXTRA_CA_CERTS</code>.</li>
            </LegalList>
          ),
        },
        {
          id: "trouble",
          title: "8. When something’s wrong",
          content: <p><code>nb doctor</code> checks Node, the server, your sign-in, proxy and certificates, the folder, disk space and your role, and says what to do for each. <code>nb feedback</code> prints a report to send to support with tokens, names and paths removed. Agents: see <Link href="/docs/agents" className="underline">AI agents</Link>.</p>,
        },
      ]}
    />
  );
}
