import type { Metadata } from "next";

import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { TerminalBlock } from "@/components/ui/terminal-block";

// Report Part H, 0.8 #12: history (H-1), branches (H-2) and merge requests (H-3); protection comes with H-4.

export const metadata: Metadata = {
  title: "History, branches and merge requests",
  description: "Every change to a workspace's files is a save you can open, compare and revert; branches come back to main through merge requests.",
};

export default function BranchesDocsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Docs · Files"
      title="History, branches and merge requests"
      summary="With History on, every change to the files becomes a save: who changed what, when, and with which agent. Branches let you work next to main without touching it, from the app or a folder that follows git, and come back through a reviewed merge request."
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
          id: "branches",
          title: "4. Branches",
          content: (
            <>
              <p>A branch is a separate line of work: main’s files as they were when it started, plus its own saves. Main doesn’t change until you bring the work back. Files tab → <strong>Branches</strong> (or press <kbd>b</kbd>) lists them with how many saves each is ahead of and behind main. Open one to see what it changes against main, edit or add text files on it, see its saves, download it as a zip, rename or delete it (restorable for 30 days).</p>
              <LegalList>
                <li><strong>Update from main</strong> brings main’s newer work in. Files only main changed come in as they are; a file both changed is merged when the edits are in different lines. Where they overlap you choose: keep the branch’s or take main’s.</li>
                <li><strong>Names:</strong> letters, numbers, -, _, / and ., up to 100 characters; not “main”.</li>
              </LegalList>
            </>
          ),
        },
        {
          id: "folder",
          title: "5. A folder on a branch",
          content: (
            <>
              <TerminalBlock variant="command" label="Branches from your terminal">{"$ nb branch create ram/try-new-header\n$ nb push src/header.tsx\n$ nb branch update\n$ nb branch switch main"}</TerminalBlock>
              <p>A linked folder is always on one branch, and <code>nb status</code> says which. <code>nb push</code> saves on that branch, never on main by accident, and <code>nb pull</code> brings the branch’s files. <code>nb branch switch</code> works like <code>git checkout</code>: files that differ are replaced, and your unsaved edits come along unless that file is different on the other branch.</p>
              <p><strong>With git:</strong> nb follows git’s branch by itself. Switch git to <code>feature-x</code> and the next nb command moves the folder to NetworkBase’s <code>feature-x</code> (main and master follow main). A git branch NetworkBase doesn’t have yet asks once whether to create it; agents and <code>--json</code> get the question back instead of a guess. A detached git HEAD can’t push.</p>
            </>
          ),
        },
        {
          id: "merge-requests",
          title: "6. Merge requests",
          content: (
            <>
              <p>A merge request asks for review before a branch comes into main. Open one from the branch’s page (<strong>Open merge request</strong>) or with <code>nb merge-request create</code>. The title comes from the linked task or the branch name, and the description lists the branch’s saves. “Closes #4” in the description links task 4. A branch has one open merge request at a time.</p>
              <LegalList>
                <li><strong>Reviewers:</strong> the workspace’s owners and admins unless you choose. They’re told when it’s opened, or when a draft is marked ready.</li>
                <li><strong>Reviewing:</strong> comment, comment on lines of a file, or suggest an edit. The author applies a suggestion with <strong>Apply suggestion</strong>, which saves it on the branch. Then <strong>Approve</strong> or <strong>Request changes</strong>. You can’t approve your own, and agents comment but don’t approve. An approval stays when more saves arrive, marked “an earlier save”.</li>
                <li><strong>Checks:</strong> builds post results for the branch’s latest save (<code>POST /api/v1/workspaces/:id/merge-requests/:n/checks</code>). They’re shown; requiring them comes with protection.</li>
                <li><strong>Merging:</strong> <strong>Merge</strong> adds one save to main that keeps the branch’s saves as its history; <strong>Squash and merge</strong> adds one save named after the merge request. Every file changes at once, and <strong>Revert merge</strong> undoes it. The linked task moves to Done, or to review when it needs one. The branch is then marked merged, ready to delete.</li>
                <li><strong>Can’t merge yet:</strong> when main changed the same lines, the merge stops without changing main. Update the branch from main, choose for each file, then merge.</li>
              </LegalList>
              <TerminalBlock variant="command" label="Merge requests from your terminal">{"$ nb merge-request create --draft -m \"Closes #4\"\n$ nb mr list --review-requested\n$ nb mr review 3 --approve\n$ nb mr comment 3 --file src/a.ts --line 12 --suggest \"const b = 2\"\n$ nb mr merge 3 --squash"}</TerminalBlock>
            </>
          ),
        },
        {
          id: "on",
          title: "7. Turning it on",
          content: (
            <p>Workspace settings → Files → <strong>History</strong>, for owners and admins. It starts with a “Start of history” save of the files as they are, and turns change sets on too. Turning it off keeps what’s recorded, and needs the other branches merged or deleted first.</p>
          ),
        },
      ]}
    />
  );
}
