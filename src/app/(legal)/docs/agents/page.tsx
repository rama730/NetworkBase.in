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
              <p>In a folder linked to a workspace (<code>nb init</code>), run setup for your agent. It shows the change and asks first, then the agent signs in with its own token that only reaches this workspace.</p>
              <TerminalBlock variant="command" label="Claude Code">{"$ nb agent setup claude\n$ claude"}</TerminalBlock>
              <TerminalBlock variant="command" label="Codex">{"$ nb agent setup codex\n$ codex"}</TerminalBlock>
              <TerminalBlock variant="command" label="Cursor">{"$ nb agent setup cursor"}</TerminalBlock>
              <p><code>nb agent status</code> shows what’s connected; <code>nb agent remove claude</code> disconnects.</p>
            </>
          ),
        },
        {
          id: "cloud",
          title: "1b. Agents in the cloud",
          content: (
            <>
              <p>An agent without your computer (a cloud runner, a hosted assistant) connects to the hosted server at <code>https://networkbase.in/api/mcp</code>. Give it an agent sign-in, approved from any device, limited to one workspace:</p>
              <TerminalBlock variant="command" label="Terminal">{"$ npx @networkbase/cli login --device --agent \"Cloud agent\" --profile cloud\n$ claude mcp add --transport http networkbase https://networkbase.in/api/mcp \\\n    --header \"Authorization: Bearer $NB_AGENT_TOKEN\""}</TerminalBlock>
              <p>It has the same tools as on your computer, except the ones that use local files. Revoke it any time in Settings.</p>
            </>
          ),
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
          content: <p>Task descriptions, comments and files reach the agent marked as data from people, not instructions. Agents push drafts with a message, and can’t reach other workspaces with their token.</p>,
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
