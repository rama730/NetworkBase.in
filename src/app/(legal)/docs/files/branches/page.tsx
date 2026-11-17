import type { Metadata } from "next";

import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { TerminalBlock } from "@/components/ui/terminal-block";

// Report Part H, 0.8 #12: history (H-1) first; branches and merge requests are added here as they ship.

export const metadata: Metadata = {
  title: "History and branches",
  description: "Every change to a workspace's files is a save you can open, compare and revert.",
};

export default function BranchesDocsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Docs · Files"
      title="History and branches"
      summary="With History on, every change to the files becomes a save: who changed what, when, and with which agent. Open any save to see its diffs or the files as they were, download it as a zip, or revert it."
      version="2.4"
      sections={[
        {
          id: "saves",
          title: "1. Saves",
          content: (
            <>
              <p>A save is one change to the files, like a commit: the files added, changed, moved and deleted, a message, and who made it. Everything that changes files makes one: saving in the editor, uploads, moving and deleting, <code>nb push</code>, an applied change set, “Use this version”, restoring from Trash and pulls from GitHub.</p>
              <LegalList>
                <li><strong>Task files and final files</strong> aren’t part of it: they belong to their tasks.</li>
                <li><strong>History is for the workspace’s people.</strong> Public visitors don’t see it.</li>
              </LegalList>
            </>
          ),
        },
        {
          id: "app",
          title: "2. In the app",
          content: (
            <p>Files tab → <strong>History</strong> lists saves, newest first, and filters by file or folder. Open one to see each file’s diff, <strong>Browse files at this save</strong>, <strong>Download zip</strong>, or <strong>Revert</strong>. A file’s version panel links each version to its save.</p>
          ),
        },
        {
          id: "terminal",
          title: "3. From your terminal",
          content: (
            <>
              <TerminalBlock variant="command" label="History">{"$ nb log src/app\n$ nb show 12 --diff src/app/page.tsx\n$ nb revert 12"}</TerminalBlock>
              <p>Revert makes a new save that puts the files back as they were before that save. Later work on the same files is kept where it doesn’t overlap; where it does, you choose, as with a <a href="/docs/files/changes" className="underline underline-offset-2">change set</a>.</p>
            </>
          ),
        },
        {
          id: "on",
          title: "4. Turning it on",
          content: (
            <p>Workspace settings → Files → <strong>History</strong>, for owners and admins. It starts with a “Start of history” save of the files as they are, and turns change sets on too. Turning it off keeps what’s recorded. Branches and merge requests come next.</p>
          ),
        },
      ]}
    />
  );
}
