import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocumentPage, LegalList } from "@/components/legal/LegalDocumentPage";

// The teacher guide (report §45.8, decision 177): one help page from creating a class to the end of term.

export const metadata: Metadata = {
  title: "Running a class on NetworkBase",
  description: "Create an organization, invite your class, give work, review it and close the term.",
};

const START = "/workspaces/new?start=organization";

export default function RunningAClassPage() {
  return (
    <LegalDocumentPage
      eyebrow="Help · For classes and teams"
      title="Running a class on NetworkBase"
      summary="From creating the organization to the end of term, in the order you’ll need it."
      version="2026-11-03"
      sections={[
        {
          id: "create",
          title: "1. Create the organization",
          content: (
            <>
              <p><Link href={START} className="underline">Create an organization</Link> and pick Education. It sets the words (Teacher, TA, Student), turns on review for hand-ins, and plans the term as Units (Unit 1, Unit 2), each with Weeks inside. Settings → Work can give them another name.</p>
              <p>Add a welcome note. Students see it once when they join, with what to do first.</p>
            </>
          ),
        },
        {
          id: "invite",
          title: "2. Invite the class",
          content: (
            <LegalList>
              <li><strong>By code:</strong> share the join code or its link. Students join at once, or after you approve them if you turn approval on.</li>
              <li><strong>By email:</strong> paste up to 500 addresses, with a short message. People without an account join when they sign up with that address.</li>
              <li><strong>TAs:</strong> invite them as Admins. Viewers can read but not hand in, and join only by email invite.</li>
            </LegalList>
          ),
        },
        {
          id: "plan",
          title: "3. Plan the term",
          content: <p>On Sprints, create the first sprint and tick Repeat to plan the rest of the term. Each team workspace can follow your sprints, with its own sprint inside each one.</p>,
        },
        {
          id: "assign",
          title: "4. Give work",
          content: (
            <LegalList>
              <li>On Tasks, choose New task and pick more than one person: it becomes an assignment, and each student gets their own copy.</li>
              <li>Choose what they hand in (a file, a link, text or nothing), the due date in your organization’s time zone, and whether you review it.</li>
              <li>For group work, pick Teams: make groups by hand or let NetworkBase make them. Publish now, when the sprint starts, or on a date.</li>
            </LegalList>
          ),
        },
        {
          id: "review",
          title: "5. Review and return",
          content: (
            <>
              <p>In review on Tasks opens the queue, one hand-in at a time. Approve or Return with what to change and a Fix by date; keys A, R, J and K move through it.</p>
              <p>Open an assignment’s card for its roster: Remind, Extend, Excuse, Give to, Export, and class questions, where Tell everyone shares an answer with the whole class.</p>
            </>
          ),
        },
        {
          id: "watch",
          title: "6. Keep an eye on the class",
          content: <p>Overview shows what needs you today, this week, and who is behind or inactive. Members has each person’s work.</p>,
        },
        {
          id: "end",
          title: "7. End of term",
          content: (
            <LegalList>
              <li>From two weeks before the term ends, Overview lists what’s left: open reviews, contributions to verify and a reminder to write up their work.</li>
              <li>Export progress and Download all keep a record. Then Archive: everything becomes read only, and members keep their record.</li>
              <li>Duplicate starts next term’s organization from this one, without its people.</li>
            </LegalList>
          ),
        },
        {
          id: "privacy",
          title: "8. What admins can see",
          content: <p>Admins see each student’s hand-ins, status and when they were last active in the organization, never their activity elsewhere on NetworkBase. Students see only their own work, and whether it was approved or returned. Read the <Link href="/privacy" className="underline">Privacy Policy</Link> for the details.</p>,
        },
      ]}
    />
  );
}
