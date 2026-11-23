import type { Metadata } from "next";

import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";
import { TerminalBlock } from "@/components/ui/terminal-block";

// Member settings (docs/superpowers/plans/2026-11-12-member-settings-concept.md §7): Your settings, completing your
// part, reopening it, and leaving.

export const metadata: Metadata = {
  title: "Your part in a workspace",
  description: "Your settings in a workspace, completing your part when your work is done, reopening it, and leaving.",
};

export default function YourPartDocsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Docs · Workspaces"
      title="Your part in a workspace"
      summary="Every member has their own settings in a workspace. When your work there is done you complete your part: you stay part of its history, and your profile shows when you started and when you finished."
      version="1.0"
      sections={[
        {
          id: "settings",
          title: "1. Your settings",
          content: (
            <>
              <p>Workspace <strong>Settings → Your settings</strong> is there for every member, whatever their role. It only changes things for you; the workspace’s own settings stay as the owner set them.</p>
              <LegalList>
                <li><strong>Your part here:</strong> your role, when you joined, Active or Completed, who the owner and admins are, and what your role can do. <strong>Ask for a different role</strong> sends the owner your request.</li>
                <li><strong>Notifications:</strong> all, mentions and replies only, or off, and each notice on its own where the owner allows it. Required notices always come. <strong>Mute</strong> for a day, a week, or until you turn it back on.</li>
                <li><strong>How your work shows:</strong> when the owner turns on <strong>Let members choose</strong>, you can hide “with Claude Code” on your own work. You still see it; nobody else does. <strong>Show this workspace on my profile.</strong></li>
                <li><strong>Your agents here:</strong> the agent sign-ins that can reach this workspace, and <strong>Keep my agents out</strong>, which refuses every agent request here as you, “all my workspaces” agents included.</li>
                <li><strong>Your devices</strong> and <strong>Your view</strong>: your CLI and editor sign-ins, the tab the workspace opens on for you, and compact or comfortable task cards.</li>
              </LegalList>
            </>
          ),
        },
        {
          id: "complete",
          title: "2. Completing your part",
          content: (
            <>
              <p><strong>Complete my part</strong> first shows what’s still open: tasks assigned to you (keep them, give them to someone, or unassign them), reviews waiting on you (they go to the owner), and your open change sets, branches, merge requests and drafts, which stay as they are. Add a closing note of up to 280 characters if you like; it shows on your profile.</p>
              <LegalList>
                <li><strong>You stay a member, read-only.</strong> You can read, comment and react. Changes are refused with the reason, in the app, the API, the CLI and for your agents, which act as you.</li>
                <li><strong>Your profile</strong> shows the entry as <strong>Mar – Nov 2026 · Completed</strong>, with your note.</li>
                <li><strong>Notifications</strong> become mentions and replies only. You can change that back.</li>
                <li><strong>The owner and admins</strong> are told, and can <strong>Confirm</strong> it (your profile then says who) or answer <strong>Not yet</strong> with a note. Not yet never reopens anything by itself.</li>
                <li><strong>Undo</strong> from the toast for 10 seconds, or <code>nb undo</code>, removes the completion as if it never happened.</li>
                <li>The owner can’t complete their own part: they transfer ownership first, or complete the whole workspace.</li>
              </LegalList>
            </>
          ),
        },
        {
          id: "reopen",
          title: "3. Reopening",
          content: (
            <p><strong>Reopen my part</strong> brings back your role and write access. The finished period stays on your profile, and a new one starts today, so it reads <strong>Mar – Nov 2026 · Completed</strong> and then <strong>Jan 2027 – Now</strong>. The owner and admins are told.</p>
          ),
        },
        {
          id: "owner",
          title: "4. For owners and admins",
          content: (
            <LegalList>
              <li><strong>Complete their part</strong> in a member’s Actions menu, for someone who stopped showing up. They’re told, their profile says who marked it, and they can reopen it. Admins can do this for members and viewers, not other admins. From a terminal it needs “verify it’s you”.</li>
              <li><strong>Complete this workspace</strong>, for the owner in Settings → Workspace management: every active member’s part completes with today’s date and the note “Workspace completed”. Setting it back to active reopens nobody; each person reopens their own part.</li>
              <li>A role can’t change while someone’s part is completed, and completed people aren’t offered for new tasks or reviews.</li>
            </LegalList>
          ),
        },
        {
          id: "leave",
          title: "5. Leaving",
          content: (
            <>
              <p><strong>Leave workspace</strong> shows the same check. Your open tasks become unassigned unless you give them to someone. Leaving ends your membership: a private workspace closes to you, one-workspace agent sign-ins stop, and reminders, watches and mutes there are removed. Your work stays, under your name. The toast offers <strong>Undo</strong> for 10 seconds; after that only a new invite brings you back, as a new period on your profile. If you completed your part first, your profile keeps <strong>Completed</strong>.</p>
            </>
          ),
        },
        {
          id: "terminal",
          title: "6. From your terminal",
          content: (
            <>
              <TerminalBlock variant="command" label="Your part">{"$ nb workspace me\n$ nb workspace complete -m \"Built the sign-in\" --give-tasks-to @sam\n$ nb workspace reopen\n$ nb workspace leave --unassign"}</TerminalBlock>
              <p>Each takes <code>--json</code>. Completing, reopening and leaving need your own sign-in: agents can read your part (<code>networkbase_my_part</code>) but can never complete or leave for you.</p>
            </>
          ),
        },
      ]}
    />
  );
}
