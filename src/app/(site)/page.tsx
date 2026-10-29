import type { Metadata } from "next";
import { genericSharePreview, shareOrigin } from "@/lib/sharing/presentation";
import { shareMetadata } from "@/lib/sharing/metadata";
import Link from "next/link";
import { ArrowRight, BarChart2, BarChart3, Bell, Code2, MapPin, FileText, FolderOpen, KeyRound, ListChecks, Lock, Megaphone, MessagesSquare, Download, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/layout/header/Logo";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { buildAuthPageHref } from "@/lib/auth/redirects";
import { SkillIcon } from "@/components/skills/SkillIcon";
import { findCatalogSkill } from "@/lib/skills/catalog";
import { toSkillSummary } from "@/lib/skills/presentation";

export const metadata: Metadata = {
  ...shareMetadata(genericSharePreview({ kind: "application", identifier: "", url: shareOrigin() + "/" }, "ready")),
  title: "NetworkBase — Find your people. Build something together.",
  description: "Discover workspaces, find people by skill, and bring tasks, files and conversations together.",
};

const anchors = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#people", label: "People" },
  { href: "#workspace", label: "Workspace" },
];

const steps = [
  { label: "01 / Discover", title: "Find work you want to be part of.", body: "Browse projects by skills and interests. See the idea, the team and the roles they still need.", href: buildAuthPageHref("/signup", "/discover"), action: "Explore projects" },
  { label: "02 / Connect", title: "Meet people through what they do.", body: "Profiles are built around skills and contributions. Find people and start a conversation.", href: buildAuthPageHref("/signup", "/network"), action: "Meet people" },
  { label: "03 / Build", title: "Give your project a place to grow.", body: "Tasks, sprints, documents, files and messages live together, with clear roles for everyone.", href: buildAuthPageHref("/signup", "/projects/new"), action: "Start a project" },
];

// Example content only: labelled as such on the page, never presented as real people or counts.
// Drawn with the Network page's person card classes (components/network/PersonCardContent.tsx).
const exampleProfiles = [
  { initials: "AK", name: "Aisha K.", headline: "Frontend developer", location: "Bengaluru", skills: ["React", "TypeScript", "Accessibility testing"], shared: 3 },
  { initials: "MR", name: "Marco R.", headline: "Product designer", location: "Lisbon", skills: ["Figma", "Design systems", "UX Research"], shared: 5 },
  { initials: "JS", name: "Jun S.", headline: "Data engineer", location: "Singapore", skills: ["Python", "SQL", "Apache Airflow"], shared: 2 },
  { initials: "LT", name: "Lena T.", headline: "Mobile developer", location: "Berlin", skills: ["Flutter", "Firebase", "Swift"], shared: 4 },
].map((person) => ({
  ...person,
  skills: person.skills.flatMap((name) => {
    const skill = findCatalogSkill(name);
    return skill ? [toSkillSummary(skill)] : [];
  }),
}));

const modules = [
  { icon: ListChecks, title: "Tasks and sprints", body: "Plan the work, assign it, and see what moves each sprint." },
  { icon: FileText, title: "Documents", body: "Specs, notes and decisions, written next to the work." },
  { icon: FolderOpen, title: "Files", body: "One place for designs, code and assets, with previews." },
  { icon: Megaphone, title: "Updates", body: "Share progress with your team and the people following along." },
  { icon: MessagesSquare, title: "Messages", body: "Channels and direct messages for every project." },
  { icon: BarChart3, title: "Dashboard", body: "Activity, progress and contributions at a glance." },
  { icon: KeyRound, title: "Roles and permissions", body: "Decide who can view, edit and manage each project." },
  { icon: Code2, title: "Editor sync", body: "Work on project files and tasks from VS Code, Cursor or Windsurf." },
];

const trust = [
  { icon: Lock, title: "You choose who sees your profile", body: "Set your visibility and who can contact you." },
  { icon: ShieldCheck, title: "Two-step sign-in", body: "Protect your account with an authenticator app." },
  { icon: Download, title: "Your data stays yours", body: "Export it or delete your account at any time." },
];

function SectionHeading({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: React.ReactNode; body?: string }) {
  return (
    <div className="mb-10 max-w-[60ch] space-y-4">
      <p className="nb-micro">{eyebrow}</p>
      <h2 id={id} className="text-[32px] font-semibold leading-tight tracking-[-0.015em] sm:text-[38px]">{title}</h2>
      {body ? <p className="text-base leading-relaxed text-muted-foreground">{body}</p> : null}
    </div>
  );
}

// Same parts as the app's project card (components/projects/ProjectCard.tsx), drawn statically and labelled as examples.
const exampleProjects = [
  { title: "Campus food-share app", body: "Helping students share leftover meals before they go to waste.", skills: ["Flutter", "Firebase", "TypeScript", "Figma"], team: ["RN", "SK", "PD"], openRoles: 3, views: 128, followers: 24 },
  { title: "Open-source study planner", body: "A shared planner for study groups, with reminders and progress tracking.", skills: ["Next.js", "React", "PostgreSQL", "Tailwind CSS"], team: ["AM", "JT"], openRoles: 1, views: 64, followers: 11 },
].map((project) => ({
  ...project,
  skills: project.skills.flatMap((name) => {
    const skill = findCatalogSkill(name);
    return skill ? [toSkillSummary(skill)] : [];
  }),
}));

function ExampleProjects() {
  return (
    <div className="w-full space-y-3" role="img" aria-label="Example project cards: skills, team, open roles, views and followers">
      <p className="nb-micro">Example projects</p>
      {exampleProjects.map(({ title, body, skills, team, openRoles, views, followers }) => (
        <div key={title} className="nb-project-card" aria-hidden="true">
          <p className="nb-project-card-title">{title}</p>
          <p className="-mt-[7px] text-sm leading-normal text-muted-foreground">{body}</p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill) => <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>)}
          </div>
          <div className="nb-project-card-footer">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex -space-x-1.5">
                {team.map((initials) => <span key={initials} className="flex size-[26px] items-center justify-center rounded-md border-2 border-card bg-secondary text-[11px] font-semibold">{initials}</span>)}
              </div>
              <span className="nb-meta text-primary">{openRoles} open {openRoles === 1 ? "role" : "roles"}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="nb-meta flex items-center gap-1 px-1"><BarChart2 size={14} />{views}</span>
              <span className="nb-icon-button gap-1 px-1.5 font-mono text-xs"><Bell size={16} />{followers}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  return <div className="min-h-dvh bg-background text-foreground">
    <a href="#main-content" className="nb-skip-link">Skip to content</a>
    <header className="nb-site-header">
      <nav aria-label="Website navigation" className="nb-site-nav">
        <Logo />
        <div className="hidden items-center gap-6 text-sm md:flex">
          {anchors.map(({ href, label }) => <a key={href} href={href} className="hover:text-primary">{label}</a>)}
        </div>
        <div className="flex items-center gap-2 text-sm sm:gap-4">
          <Link href="/login" className="inline-flex min-h-11 items-center px-2 hover:text-primary">Sign in</Link>
          <Button asChild><Link href="/signup">Get started</Link></Button>
        </div>
      </nav>
    </header>

    <main id="main-content" tabIndex={-1}>
      <section className="nb-grid-ground border-b border-border" aria-labelledby="hero-title">
        <div className="nb-site-hero">
          <div className="space-y-6">
            <p className="nb-micro text-primary">A place for people who build</p>
            <h1 id="hero-title" className="max-w-[12ch] text-[40px] font-semibold leading-[1.06] tracking-[-.03em] sm:text-6xl">Find your people.<br />Build something together.</h1>
            <p className="max-w-[52ch] text-[17px] leading-relaxed text-muted-foreground">NetworkBase connects people who want to build with the projects that need them, then gives the team one place to plan, write, share and ship.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" asChild><Link href="/signup">Get started <ArrowRight size={16} aria-hidden="true" /></Link></Button>
              <Button variant="outline" size="lg" asChild><a href="#how-it-works">See how it works</a></Button>
            </div>
          </div>
          <ExampleProjects />
        </div>
      </section>

      <section className="nb-site-section nb-site-anchor" id="how-it-works" aria-labelledby="how-title">
        <SectionHeading id="how-title" eyebrow="How it works" title={<>The people, the project,<br />and the work in between.</>} />
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(({ label, title, body, href, action }) => (
            <article key={label} className="nb-site-preview flex flex-col items-start gap-4 p-6">
              <span className="nb-micro">{label}</span>
              <h3 className="text-xl font-semibold leading-snug">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              <Link href={href} className="mt-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">{action} <ArrowRight size={14} aria-hidden="true" /></Link>
            </article>
          ))}
        </div>
      </section>

      <section className="nb-site-section nb-site-anchor !pt-0" id="people" aria-labelledby="people-title">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <SectionHeading id="people-title" eyebrow="The talent pool" title="Find people by what they can do." body="Every profile shows skills, experience, weekly availability and the projects someone has worked on. Search by skill, or post an open role and let the right people find you." />
            <ul className="space-y-3 text-sm">
              {["Search by skill, role and experience level", "See who is open to collaborate and how many hours they have", "Post open roles on your project", "Start a conversation from any profile"].map((point) => (
                <li key={point} className="flex gap-3"><Users className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{point}</li>
              ))}
            </ul>
          </div>
          <div role="img" aria-label="Example profiles showing role, experience, weekly hours and skills">
            <p className="nb-micro mb-3">Example profiles</p>
            <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
              {exampleProfiles.map(({ initials, name, headline, location, skills, shared }) => (
                <div key={initials} className="nb-person-card-host">
                  <div className="nb-person-card">
                    <div className="nb-person-identity">
                      <span className="nb-person-avatar flex items-center justify-center rounded-md bg-secondary text-sm font-semibold">{initials}</span>
                      <div className="nb-person-identity-text">
                        <p className="nb-person-name-line"><span className="nb-person-name">{name}</span><span className="nb-person-collaboration">Open to collaborate</span></p>
                        <div className="nb-person-subtitle"><span className="nb-compact block truncate text-muted-foreground">{headline}</span></div>
                      </div>
                    </div>
                    <div className="nb-person-action"><button type="button" tabIndex={-1} className="nb-person-connect">Connect</button></div>
                    <div className="nb-person-context"><span className="nb-meta nb-person-location"><MapPin className="size-3.5 shrink-0" /><span>{location}</span></span></div>
                    <div className="nb-person-skills-row">
                      <div className="nb-person-skill-strip">
                        {/* Two skills and a "+N" chip, as the live strip shows when space runs out. */}
                        {skills.slice(0, 2).map((skill) => <span key={skill.canonicalKey} className="nb-tag nb-person-skill"><SkillIcon skill={skill} size={14} /><span className="nb-person-skill-label">{skill.name}</span></span>)}
                        {skills.length > 2 ? <span className="nb-tag nb-person-skill nb-person-more">+{skills.length - 2}</span> : null}
                      </div>
                    </div>
                    <div className="nb-person-relationship"><span className="nb-meta nb-person-shared"><Users className="size-3 shrink-0" />{shared} shared connections</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="nb-site-section nb-site-anchor border-t border-border" id="workspace" aria-labelledby="workspace-title">
        <SectionHeading id="workspace-title" eyebrow="The workspace" title="Everything a project needs, in one place." body="When the team comes together, the work has somewhere to live. No more scattered links, chats and spreadsheets." />
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {modules.map(({ icon: Icon, title, body }) => (
            <div key={title} className="space-y-2 bg-card p-5">
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <h3 className="text-[15px] font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="nb-site-section !pt-0" aria-labelledby="process-title">
        <div className="nb-site-process nb-grid-ground grid gap-12 md:grid-cols-2">
          <div className="space-y-5">
            <p className="nb-micro nb-inverse-muted">A practical way to get going</p>
            <h2 id="process-title" className="text-[32px] font-semibold leading-tight sm:text-[38px]">Make room for<br />your next idea.</h2>
            <p className="nb-inverse-muted max-w-[36ch]">Start small, find the people who care about the same problem, and build your way forward.</p>
          </div>
          <ol className="space-y-6">
            {["Set up your profile and add your skills.", "Find a project or create one of your own.", "Invite members and agree on the next steps.", "Share your progress as the work takes shape."].map((text, index) => (
              <li key={text} className="flex gap-4 border-b border-white/15 pb-5"><span className="font-mono text-sm text-[var(--accent-inverse)]">0{index + 1}</span><span>{text}</span></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="nb-site-section !pt-0" aria-labelledby="trust-title">
        <h2 id="trust-title" className="sr-only">Privacy and security</h2>
        <div className="grid gap-6 border-y border-border py-8 md:grid-cols-3">
          {trust.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div><h3 className="text-[15px] font-semibold">{title}</h3><p className="text-sm text-muted-foreground">{body}</p></div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Read the <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">Privacy Policy</Link> or <Link href="/security-reporting" className="font-medium text-foreground underline underline-offset-4">report a security issue</Link>.</p>
      </section>

      <section className="nb-site-section text-center" aria-labelledby="cta-title">
        <h2 id="cta-title" className="mx-auto max-w-[26ch] font-serif text-4xl font-normal leading-tight sm:text-5xl">Your work says more<br />when you build it together.</h2>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
          <Button asChild size="lg"><Link href="/signup">Get started <ArrowRight size={16} aria-hidden="true" /></Link></Button>
          <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium hover:text-primary">Sign in</Link>
        </div>
      </section>
    </main>

    <footer className="border-t border-border bg-muted">
      <div className="nb-site-section !py-10 grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Logo />
          <p className="max-w-[36ch] text-sm text-muted-foreground">Find people, join workspaces and work together.</p>
        </div>
        <nav aria-label="Product" className="space-y-2 text-sm">
          <p className="nb-micro">Product</p>
          {anchors.map(({ href, label }) => <a key={href} href={href} className="block hover:text-primary pointer-coarse:min-h-11">{label}</a>)}
        </nav>
        <nav aria-label="Account" className="space-y-2 text-sm">
          <p className="nb-micro">Account</p>
          <Link href="/login" className="block hover:text-primary pointer-coarse:min-h-11">Sign in</Link>
          <Link href="/signup" className="block hover:text-primary pointer-coarse:min-h-11">Get started</Link>
        </nav>
        <div className="border-t border-border pt-6 md:col-span-3">
          <LegalLinks align="start" showCopyright />
        </div>
      </div>
    </footer>
  </div>;
}
