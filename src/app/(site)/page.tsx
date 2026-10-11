import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, UsersRound, FolderKanban, Check, FileText, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/layout/header/Logo";
import { LegalLinks } from "@/components/legal/LegalLinks";

export const metadata: Metadata = {
  title: "NetworkBase — Find your people. Build something together.",
  description: "Discover projects, find collaborators, and bring tasks, files and conversations together in one workspace.",
};

const pillars = [
  { icon: Compass, label: "01 / Discover", title: "Find work you want to be part of.", body: "Explore projects by skills and interests. Understand the idea, meet the team, and see where you can contribute.", href: "/discover", action: "Explore projects" },
  { icon: UsersRound, label: "02 / Connect", title: "Meet people through what they do.", body: "Build a profile around your skills and contributions. Connect with collaborators and start a conversation.", href: "/network", action: "Explore the network" },
  { icon: FolderKanban, label: "03 / Build", title: "Give your project a place to grow.", body: "Keep tasks, sprints, documents, files and conversations together, with clear roles and a shared view of the work.", href: "/projects/new", action: "Start a project" },
];

export default function HomePage() {
  return <div className="min-h-dvh bg-background text-foreground">
    <a href="#main-content" className="nb-skip-link">Skip to content</a>
    <header className="border-b border-border bg-card"><nav aria-label="Website navigation" className="nb-site-nav"><Logo /><div className="flex items-center gap-5 text-sm"><Link href="/discover" className="hidden sm:inline hover:text-primary">Discover</Link><Link href="/network" className="hidden sm:inline hover:text-primary">Network</Link><Link href="/login" className="hover:text-primary max-sm:inline-flex max-sm:min-h-11 max-sm:min-w-11 max-sm:items-center max-sm:justify-center">Sign in</Link><Button asChild><Link href="/signup">Join NetworkBase</Link></Button></div></nav></header>
    <main id="main-content" tabIndex={-1}>
      <section className="nb-grid-ground border-b border-border">
        <div className="nb-site-hero">
          <div className="space-y-6"><p className="nb-micro text-primary">A place for people who build</p><h1 className="max-w-[12ch] text-[36px] sm:text-6xl font-semibold leading-[1.06] tracking-[-.03em]">Find your people.<br />Build something together.</h1><p className="max-w-[52ch] text-base leading-relaxed text-muted-foreground">Good projects start with an idea. Great ones grow through the people behind them. Discover your next collaboration and give your work a shared home.</p><div className="flex flex-wrap items-center gap-3"><Button size="lg" asChild><Link href="/signup">Get started <ArrowRight size={16} aria-hidden="true" /></Link></Button><Button variant="outline" size="lg" asChild><Link href="/discover">Explore projects</Link></Button></div></div>
          <div className="nb-site-preview" aria-label="Project workspace overview">
            <div className="border-b border-border px-5 py-4 flex items-center justify-between"><span className="nb-micro">Your workspace</span><FolderKanban size={18} className="text-primary" aria-hidden="true" /></div>
            <div className="p-5 space-y-5"><div className="space-y-2"><span className="nb-status" data-status="draft">Start with an idea</span><h2 className="text-2xl font-semibold leading-snug">Your next project starts here.</h2><p className="text-sm text-muted-foreground">Bring the right people together around work that matters to you.</p></div><div className="flex flex-wrap gap-1.5"><span className="nb-tag">Shared goals</span><span className="nb-tag">Clear roles</span><span className="nb-tag">Visible progress</span></div><div className="border-t border-border pt-3 divide-y divide-border">{[{ icon: UsersRound, title: "A team with a shared purpose", text: "Profiles, skills and open roles" }, { icon: ListChecks, title: "A clear next step", text: "Tasks, sprints and milestones" }, { icon: FileText, title: "The context behind the work", text: "Documents, files and conversations" }].map(({ icon: Icon, title, text }) => <div key={title} className="flex items-start gap-3 py-3"><Icon size={16} className="mt-1 text-primary" aria-hidden="true" /><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{text}</p></div></div>)}</div><Link href="/projects/new" className="flex items-center justify-between border-t border-border pt-4 text-sm font-medium text-primary max-sm:min-h-11">Create your project <ArrowRight size={16} aria-hidden="true" /></Link></div>
          </div>
        </div>
      </section>
      <section className="nb-site-section" aria-labelledby="work-together"><p className="nb-micro mb-4">From discovery to delivery</p><h2 id="work-together" className="max-w-[22ch] text-4xl font-semibold leading-tight tracking-tight mb-10">The people, the project,<br />and the work in between.</h2><div className="grid md:grid-cols-3 gap-8">{pillars.map(({ icon: Icon, label, title, body, href, action }) => <article key={label} className="flex flex-col items-start gap-4 border-t border-border pt-5"><div className="flex w-full justify-between"><span className="nb-micro">{label}</span><Icon size={18} className="text-primary" aria-hidden="true" /></div><h3 className="text-xl font-semibold leading-snug">{title}</h3><p className="text-sm text-muted-foreground leading-relaxed">{body}</p><Link href={href} className="mt-auto pt-2 text-sm font-medium text-primary hover:underline max-sm:inline-flex max-sm:min-h-11 max-sm:items-center max-sm:pt-0">{action} →</Link></article>)}</div></section>
      <section className="nb-site-process nb-grid-ground"><div className="nb-site-section grid md:grid-cols-2 gap-12"><div className="space-y-5"><p className="nb-micro text-[#A9B4B9]">A practical way to get going</p><h2 className="text-4xl font-semibold leading-tight">Make room for<br />your next idea.</h2><p className="text-[#B6C0C5] max-w-[36ch]">Start small, find the people who care about the same problem, and build your way forward.</p></div><ol className="space-y-6">{["Set up your profile and add your skills.","Find a project or create one of your own.","Invite collaborators and agree on the next steps.","Share your progress as the work takes shape."].map((text,index) => <li key={text} className="flex gap-4 border-b border-white/15 pb-5"><span className="font-mono text-sm text-[#F3A17E]">0{index+1}</span><span>{text}</span></li>)}</ol></div></section>
      <section className="nb-site-section text-center"><p className="font-serif text-4xl sm:text-5xl leading-tight max-w-[26ch] mx-auto">Your work says more<br />when you build it together.</p><div className="mt-7 flex justify-center"><Button asChild size="lg"><Link href="/signup">Join NetworkBase <Check size={16} aria-hidden="true" /></Link></Button></div></section>
    </main>
    <footer className="border-t border-border bg-card">
      <div className="nb-site-section !py-8 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <Logo />
          <p className="nb-meta text-xs text-muted-foreground">
            © {new Date().getFullYear()} NetworkBase™. All rights reserved.
          </p>
        </div>
        <LegalLinks className="max-w-2xl md:justify-end" />
      </div>
    </footer>
  </div>;
}
