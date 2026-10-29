import { defaultOrgRoleNames, type OrgType } from "@/lib/organizations/config";

// Organization creation by type (report §34): the words each step shows and the defaults the type sets.
// Client-safe: the wizard reads it, and the server reads the same defaults when it creates the org.

export const ORG_TYPE_CARDS: Record<OrgType, { label: string; hint: string }> = {
  education: { label: "Education", hint: "A class, batch or semester" },
  company: { label: "Company", hint: "A team, department or region" },
  community: { label: "Community", hint: "An open group with shared projects" },
  research: { label: "Research", hint: "A lab or research group" },
  club: { label: "Club", hint: "A student or hobby club" },
  other: { label: "Other", hint: "Anything else: a nonprofit, an event, a government team" },
};

type CreationCopy = {
  name: string;
  tagline: string;
  about: string;
  audience: string;
  activities: string;
  welcome: string;
  subjectLabel: string;
  subjects: string[];
  topics: string[];
  termLabel: string;
  starterDoc: string;
};

const SHARED: CreationCopy = {
  name: "Bangalore rust meetup",
  tagline: "Monthly meetups and shared projects for Rust developers",
  about: "What the group is about and how to take part",
  audience: "Rust developers in Bangalore, beginners welcome",
  activities: "Monthly talks, beginner projects, hack nights",
  welcome: "Say hi in #general",
  subjectLabel: "Topic",
  subjects: ["Programming", "Design", "Startups", "Open source"],
  topics: ["community", "meetups", "open-source"],
  termLabel: "Season",
  starterDoc: "Code of conduct",
};

export const ORG_CREATION_COPY: Record<OrgType, CreationCopy> = {
  education: {
    name: "CSE-3A 2026 · Data Structures",
    tagline: "Data Structures for 3rd-semester CSE, Section A",
    about: "What the course covers, how it runs, and what students should know first",
    audience: "Students of B.Tech CSE, 3rd semester, Section A",
    activities: "Weekly labs, two group projects, a mini-project proposal by Oct 15",
    welcome: "Read the syllabus first. Labs are due Sundays at 11 pm.",
    subjectLabel: "Subject",
    subjects: ["Computer science", "Electronics", "Mechanical", "Mathematics", "Business"],
    topics: ["data-structures", "algorithms", "c", "labs"],
    termLabel: "Term",
    starterDoc: "Syllabus",
  },
  company: {
    name: "Acme Sales APAC",
    tagline: "The APAC sales team’s shared workspace",
    about: "What the team does and how work flows",
    audience: "The APAC sales team and its regional leads",
    activities: "Weekly pipeline reports, monthly pushes, shared playbooks",
    welcome: "Start with the team handbook in Docs.",
    subjectLabel: "Department",
    subjects: ["Sales", "Engineering", "Marketing", "Operations", "Support"],
    topics: ["sales", "pipeline", "playbooks"],
    termLabel: "Period",
    starterDoc: "Team handbook",
  },
  research: {
    name: "Vision lab",
    tagline: "Computer vision research at RVCE",
    about: "The lab’s focus and how projects run",
    audience: "PhD and master’s students in the lab",
    activities: "Weekly reading group, paper drafts, shared datasets",
    welcome: "Add yourself to a project in Projects.",
    subjectLabel: "Research area",
    subjects: ["Computer vision", "NLP", "Robotics", "Biology", "Physics"],
    topics: ["research", "papers", "datasets"],
    termLabel: "Project period",
    starterDoc: "Lab guide",
  },
  community: SHARED,
  club: { ...SHARED, name: "Robotics club", tagline: "Build robots, enter competitions, learn together", subjectLabel: "Activity", subjects: ["Robotics", "Coding", "Music", "Sports", "Debate"] },
  other: { ...SHARED, name: "Name of your organization", tagline: "One line about what it does", about: "What this organization is and what happens in it", subjectLabel: "Focus", termLabel: "Period", starterDoc: "Blank" },
};

/** What the type sets until the person changes it (report §34.4, §34.5, decision 185). */
export function orgTypeDefaults(type: OrgType) {
  const roleNames = defaultOrgRoleNames(type);
  const open = type === "education" || type === "community" || type === "club";
  return {
    roleNames,
    creatorTitle: roleNames.owner,
    joinMode: open ? ("instant" as const) : ("approval" as const),
    visibility: type === "community" || type === "club" ? ("public" as const) : ("private" as const),
    memberUpdates: type !== "education",
    sprintPrefix: type === "education" ? "CO" : "Sprint ",
  };
}

/** One line for the invite message on the success screen (report §34.8). */
export function orgInviteMessage(input: { title: string; joinCode: string; signedBy?: string | null }) {
  return `Join ${input.title} on NetworkBase with code ${input.joinCode}.${input.signedBy ? ` — ${input.signedBy}` : ""}`;
}

const STARTER_SECTIONS: Record<string, string[]> = {
  Syllabus: ["What this course covers", "Schedule", "How work is submitted and reviewed", "Late work", "Where to ask questions"],
  "Team handbook": ["What the team does", "How we work week to week", "Where things live", "Who to ask"],
  "Code of conduct": ["What this group is for", "How we treat each other", "Reporting a problem"],
  "Lab guide": ["Research focus", "Weekly rhythm", "Data and code", "Writing and authorship"],
  Blank: ["About"],
};

/** The starter doc's text for an organization (report §34.5): the type's template with the org's own words. */
export function orgStarterDoc(type: OrgType, input: { title: string; description?: string | null; audience?: string | null; activities?: string | null }) {
  const name = ORG_CREATION_COPY[type].starterDoc;
  const lines = [`# ${input.title}: ${name === "Blank" ? "About" : name}`, ""];
  if (input.description?.trim()) lines.push(input.description.trim(), "");
  if (input.audience?.trim()) lines.push(`**Who it’s for:** ${input.audience.trim()}`, "");
  if (input.activities?.trim()) lines.push(`**What members do here:** ${input.activities.trim()}`, "");
  for (const heading of STARTER_SECTIONS[name] ?? STARTER_SECTIONS.Blank!) lines.push(`## ${heading}`, "", "_Add details here._", "");
  return lines.join("\n").trimEnd() + "\n";
}
