import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { TerminalBlock } from "@/components/ui/terminal-block";

// The agents guide (report A6.8, §18, §26.6): connect Claude Code, Codex or Cursor, what to ask, and what waits for a yes.

export const metadata: Metadata = {
  title: "AI agents and NetworkBase",
  description: "Connect Claude Code, Codex or Cursor to your NetworkBase workspace, safely.",
};

export default function AgentsDocsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Docs · AI agents"
      title="AI agents and NetworkBase"
      summary="Let Claude Code, Codex or Cursor read your tasks, push drafts and ask you questions, while big changes wait for your yes."
      version="2.0"
      sections={[
        {
          id: "setup",
          title: "1. Connect an agent",
          content: (
            <>
              <p>In a folder linked to a workspace (<code>nb init</code>), run setup for your agent. It shows the change and asks first, then opens NetworkBase in your browser: the page is already filled in, so approving is one click. The terminal then says what you allowed, for example “Claude Code connected · all workspaces · asks before big changes · until 11 Dec”.</p>
              <TerminalBlock variant="command" label="Claude Code">{"$ nb agent setup claude\n$ claude"}</TerminalBlock>
              <TerminalBlock variant="command" label="Codex">{"$ nb agent setup codex\n$ codex"}</TerminalBlock>
              <TerminalBlock variant="command" label="Cursor">{"$ nb agent setup cursor"}</TerminalBlock>
              <p><code>nb agent status</code> shows what’s connected and what each agent may do; <code>nb agent remove claude</code> disconnects. On a server or over SSH the terminal shows a QR code too, so you can approve from your phone.</p>
              <p>Or add the NetworkBase plugin to Claude Code, which brings the same tools and a skill for working on tasks:</p>
              <TerminalBlock variant="command" label="Claude Code">{"/plugin marketplace add rama730/claude-code-plugin\n/plugin install networkbase@networkbase"}</TerminalBlock>
            </>
          ),
        },
        {
          id: "cloud",
          title: "1b. Agents in the cloud",
          content: (
            <>
              <p>An agent without your computer (a cloud runner, a hosted assistant) connects to the hosted server at <code>https://networkbase.in/api/mcp</code>. An editor that supports MCP sign-in opens NetworkBase in your browser: check what it may do, approve, and it continues on its own.</p>
              <TerminalBlock variant="command" label="Claude Code">{"$ claude mcp add --transport http networkbase https://networkbase.in/api/mcp"}</TerminalBlock>
              <p>Where no browser is available, give it an agent sign-in, approved from any device:</p>
              <TerminalBlock variant="command" label="Terminal">{"$ npx @networkbase/cli login --device --agent \"Cloud agent\" --profile cloud\n$ claude mcp add --transport http networkbase https://networkbase.in/api/mcp \\\n    --header \"Authorization: Bearer $NB_AGENT_TOKEN\""}</TerminalBlock>
              <p>It has the same tools as on your computer, except the ones that use local files. Revoke it any time in Settings.</p>
            </>
          ),
        },
        {
          id: "presets",
          title: "1c. What an agent may do",
          content: (
            <>
              <p>When you approve an agent, one sentence says where it works, what it does by itself, what waits for your yes, and for how long. <strong>Change</strong> on the approval page offers three choices:</p>
              <LegalList>
                <li><strong>Where:</strong> All my workspaces, or one workspace.</li>
                <li><strong>What it may do:</strong> <strong>Full help</strong> does small things itself and asks you before finishing tasks, final files, doc edits and deleting. <strong>Small changes only</strong> never finishes tasks, changes final files or edits docs. <strong>Read only</strong> looks and reports, and changes nothing. <strong>Custom</strong> lets you tick what it may ask for.</li>
                <li><strong>How long:</strong> 7, 30 or 90 days.</li>
              </LegalList>
              <p>Big changes wait for your yes whatever you choose. NetworkBase remembers your choice for each agent and starts there next time. An agent can also ask for a choice when it signs in:</p>
              <TerminalBlock variant="command" label="Terminal">{"$ nb login --device --agent \"Claude Code\" --access read --all-workspaces"}</TerminalBlock>
              <p>To change it later, open Settings → Integrations → <strong>Change access</strong>, or from the terminal:</p>
              <TerminalBlock variant="command" label="Terminal">{"$ nb agent access claude --read-only"}</TerminalBlock>
            </>
          ),
        },
        {
          id: "all-workspaces",
          title: "1d. All my workspaces",
          content: <p>An agent approved for all your workspaces is checked on every request: it reaches only workspaces you can use, never ones where agents are paused or where the organization turned agents off. It’s listed first in Settings → Integrations, and use from a new country is flagged to you by email. Revoke it there with one click.</p>,
        },
        {
          id: "asking-for-more",
          title: "1e. When an agent asks for more",
          content: (
            <>
              <p>If an agent needs something it wasn’t allowed, like finishing a task with Small changes only, it doesn’t fail or look for another way: NetworkBase asks you in your inbox, “Claude Code asks to also finish tasks”, and the agent tells you it asked.</p>
              <LegalList>
                <li><strong>Allow once:</strong> the agent’s next try of the same thing goes through, within an hour. Your answer counts as your yes for it.</li>
                <li><strong>Always:</strong> the agent keeps that permission. It asks you to confirm it’s you first.</li>
                <li><strong>No:</strong> the agent won’t ask for it again for a day.</li>
              </LegalList>
              <p>An agent can have at most three requests waiting, and each one runs out after a day.</p>
            </>
          ),
        },
        {
          id: "renewal",
          title: "1f. Renewing",
          content: <p>A week before an agent’s access ends, your inbox says “Renew Claude Code: one click”. It opens the agent’s settings with Renew ready; renewing keeps the same choices. If it ends anyway, sign it in again and the page starts from your last choice.</p>,
        },
        {
          id: "ask",
          title: "2. What you can ask",
          content: (
            <LegalList>
              <li>“How many tasks do I have?” · “What’s blocked in Design Lab?”</li>
              <li>“Create a task to update the logo, due Friday, for Sam.”</li>
              <li>“Work on task #4: read it, ask me what’s unclear, push drafts as you go.”</li>
              <li>“Change the README to add install steps.” (You see the diff first.)</li>
              <li>“Give me a three-line standup.”</li>
            </LegalList>
          ),
        },
        {
          id: "safety",
          title: "3. What waits for your yes",
          content: (
            <>
              <LegalList>
                <li><strong>Runs, with Undo:</strong> reading, creating tasks and subtasks, comments, draft files, moving your own task to In progress or Blocked.</li>
                <li><strong>Needs your yes:</strong> finishing a task, final files, deleting anything, changing someone else’s task, editing docs and the README, posting updates.</li>
                <li><strong>Never:</strong> handing in for someone, approving reviews, changing members or settings, pushing files that look like they hold a secret.</li>
              </LegalList>
              <p>A workspace owner can make agents ask for everything, or pause them, in workspace settings → Agents. Every change an agent makes shows “via Claude Code” (or the agent’s name) next to the author, and <code>nb undo --session</code> reverses what one agent session did.</p>
            </>
          ),
        },
        {
          id: "questions",
          title: "4. Questions from agents",
          content: <p>When something is unclear, the agent asks you (or the assignee or reviewer) in NetworkBase. The question shows on the task; answer there or with <code>nb ask answer</code>. An agent session sends you one summary when it ends, not a notification per change.</p>,
        },
        {
          id: "data",
          title: "5. Task text is data",
          content: <p>Task descriptions, comments and files reach the agent marked as data from people, not instructions. Agents push drafts with a message, and reach only the workspaces you approved.</p>,
        },
        {
          id: "classes",
          title: "6. Classes",
          content: <p>On organization assignments, the organization’s AI policy applies; agent-made hand-in files are labelled for the reviewer. See <Link href="/help/running-a-class" className="underline">Running a class</Link> and <Link href="/docs/cli" className="underline">the CLI guide</Link>.</p>,
        },
      ]}
    />
  );
}
