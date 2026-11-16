import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { TerminalBlock } from "@/components/ui/terminal-block";

// Report Part G, 0.8 #12: change sets for people and their agents.

export const metadata: Metadata = {
  title: "Change sets",
  description: "Multi-file work, yours or an agent's, reviewed and applied in one step, and undone in one step.",
};

export default function ChangeSetsDocsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Docs · Files"
      title="Change sets"
      summary="A redesign touches 30 files. A change set keeps them together: you see every file before it lands, it all lands at once or not at all, and one Undo puts every file back."
      version="2.2"
      sections={[
        {
          id: "what",
          title: "1. What a change set is",
          content: (
            <>
              <p>One named piece of work, like “Redesign the sign-in page”: the files it adds, changes, renames and deletes. Until it’s applied, nobody else sees it in the workspace’s files, and nothing it touches changes.</p>
              <LegalList>
                <li><strong>All or nothing.</strong> Applying writes every file in one step. If anything fails, nothing is written.</li>
                <li><strong>Never overwrites a teammate.</strong> If someone changed a file since, their change and yours are merged when they touch different lines. When they touch the same lines, you choose.</li>
                <li><strong>One Undo.</strong> Every file goes back to its version from before. Files someone changed since are named, and you can undo the rest.</li>
              </LegalList>
            </>
          ),
        },
        {
          id: "agents",
          title: "2. With an AI agent",
          content: (
            <>
              <p>Where change sets are on, an agent connected with <Link href="/docs/agents">nb agent setup</Link> works on your files as usual. Its saved files go into one change set as it works, named after the task you started. When it’s done, it finishes the change set and tells you. Small ones (up to 20 files, no deletes, final files or docs) it applies itself, with an undo. Bigger ones wait for your yes.</p>
            </>
          ),
        },
        {
          id: "terminal",
          title: "3. From your terminal",
          content: (
            <>
              <TerminalBlock variant="command" label="Start, work, check, apply">{"$ nb change start \"Redesign the sign-in page\" --task 4\n$ nb change status\n$ nb change finish\n$ nb change apply"}</TerminalBlock>
              <p><code>nb watch --change</code> adds your saves as you go. <code>nb change update</code> merges teammates’ newer versions into your files. <code>nb change resolve &lt;path&gt; --mine|--theirs</code> settles a file changed on both sides. <code>nb change undo &lt;id&gt;</code> puts everything back. A push bigger than 50 files or 4 MB goes up as one change set by itself.</p>
            </>
          ),
        },
        {
          id: "review",
          title: "4. Reviewing in the app",
          content: (
            <p>Files tab → <strong>Changes</strong> lists what’s waiting. Open one to see each file’s diff (<kbd>j</kbd> and <kbd>k</kbd> move between files), then <strong>Apply</strong>, <strong>Apply</strong> only the files you tick, <strong>Ask for changes</strong> (the agent reads it next session), or <strong>Discard</strong>. A file changed in the same lines opens the merge editor: keep yours, keep theirs, or edit the result. Every version a change set makes says which change set it was part of.</p>
          ),
        },
        {
          id: "limits",
          title: "5. Limits",
          content: (
            <LegalList>
              <li>Up to 2,000 files and 500 MB per change set; 25 MB per file.</li>
              <li>Up to 10 open change sets per person, and 3 per agent sign-in, in each workspace.</li>
              <li>Drafts count toward the workspace’s storage, up to 1 GB per person. A change set nobody touches for 30 days is discarded.</li>
              <li>A file that looks like it holds a password or key isn’t uploaded until you confirm it’s safe. Agents can’t confirm it.</li>
            </LegalList>
          ),
        },
      ]}
    />
  );
}
