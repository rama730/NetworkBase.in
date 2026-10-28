import type { Metadata } from "next";
import { genericSharePreview, shareOrigin } from "@/lib/sharing/presentation";
import { shareMetadata } from "@/lib/sharing/metadata";
import Link from "next/link";
import { ArrowRight, BarChart3, Code2, FileText, FolderOpen, KeyRound, ListChecks, Lock, Megaphone, MessagesSquare, Download, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/layout/header/Logo";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { buildAuthPageHref } from "@/lib/auth/redirects";

export const metadata: Metadata = {
  ...shareMetadata(genericSharePreview({ kind: "application", identifier: "", url: shareOrigin() + "/" }, "ready")),
  title: "NetworkBase — Find your people. Build something together.",
  description: "Discover projects, find collaborators by skill, and bring tasks, files and conversations together in one workspace.",
};

const anchors = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#people", label: "People" },
  { href: "#workspace", label: "Workspace" },
];

const steps = [
  { label: "01 / Discover", title: "Find work you want to be part of.", body: "Browse projects by skills and interests. See the idea, the team and the roles they still need.", href: buildAuthPageHref("/signup", "/discover"), action: "Explore projects" },
  { label: "02 / Connect", title: "Meet people through what they do.", body: "Profiles are built around skills and contributions. Find collaborators and start a conversation.", href: buildAuthPageHref("/signup", "/network"), action: "Meet people" },
  { label: "03 / Build", title: "Give your project a place to grow.", body: "Tasks, sprints, documents, files and messages live together, with clear roles for everyone.", href: buildAuthPageHref("/signup", "/projects/new"), action: "Start a project" },
];

// Example content only: labelled as such on the page, never presented as real people or counts.
const exampleProfiles = [
  { initials: "AK", role: "Frontend developer", level: "Mid-level", hours: "10–20 h / week", skills: ["React", "TypeScript", "Accessibility Testing"] },
  { initials: "MR", role: "Product designer", level: "Senior", hours: "5–10 h / week", skills: ["Figma", "Design Systems", "UX Research"] },
  { initials: "JS", role: "Data engineer", level: "Student", hours: "20–40 h / week", skills: ["Python", "SQL", "Apache Airflow"] },
  { initials: "LT", role: "Mobile developer", level: "Junior", hours: "10–20 h / week", skills: ["Flutter", "Firebase", "Swift"] },
];

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

function ExampleProject() {
  return (
    <div className="nb-site-preview" role="img" aria-label="Example of a project on NetworkBase: open roles, team and tasks">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <span className="nb-micro">Example project</span>
        <span className="nb-status" data-status="active">Open</span>
      </div>
      <div className="space-y-5 p-5" aria-hidden="true">
        <div className="space-y-2">
          <p className="text-xl font-semibold leading-snug">Campus food-share app</p>
          <p className="text-sm text-muted-foreground">Helping students share leftover meals before they go to waste.</p>
        </div>
        <div className="space-y-2">
          <p className="nb-micro">Open roles</p>
          <div className="flex flex-wrap gap-1.5"><span className="nb-tag">Mobile developer</span><span className="nb-tag">Designer</span><span className="nb-tag">Backend</span></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {["RN", "SK", "PD"].map((initials) => <span key={initials} className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-muted font-mono text-[11px] font-medium">{initials}</span>)}
          </div>
          <span className="text-xs text-muted-foreground">3 people on the team</span>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {[["Design the onboarding screens", "In review", "active"], ["Set up the meals API", "In progress", "draft"], ["Write the launch post", "To do", "archived"]].map(([task, state, tone]) => (
            <li key={task} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="truncate">{task}</span>
              <span className="nb-status shrink-0" data-status={tone}>{state}</span>
            </li>
          ))}
        </ul>
      </div>
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
          <ExampleProject />
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
              {exampleProfiles.map(({ initials, role, level, hours, skills }) => (
                <div key={initials} className="nb-site-preview space-y-4 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-md bg-muted font-mono text-sm font-medium">{initials}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{role}</p>
                      <p className="text-xs text-muted-foreground">{level} · {hours}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">{skills.map((skill) => <span key={skill} className="nb-tag">{skill}</span>)}</div>
                  <span className="nb-status" data-status="completed">Open to collaborate</span>
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
            {["Set up your profile and add your skills.", "Find a project or create one of your own.", "Invite collaborators and agree on the next steps.", "Share your progress as the work takes shape."].map((text, index) => (
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
          <p className="max-w-[36ch] text-sm text-muted-foreground">Find collaborators, join projects, and build together in one workspace.</p>
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
