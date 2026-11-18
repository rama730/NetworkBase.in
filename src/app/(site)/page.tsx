import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { genericSharePreview, shareOrigin } from "@/lib/sharing/presentation";
import { shareMetadata } from "@/lib/sharing/metadata";
import { PIXEL_ICONS } from "@/lib/pixel-icons";
import { buildAuthPageHref } from "@/lib/auth/redirects";
import { findCatalogSkill } from "@/lib/skills/catalog";
import { TRAIL, isLightHex } from "@/lib/grid-trail";
import { parseReleaseNotes } from "@/lib/site/release-notes";
import { WORKSPACE_MODULES } from "@/components/site/home/WorkspaceMocks";
import { HomeEffects } from "@/components/site/home/HomeEffects";
import "./home.css";

// Home page redesign: docs/superpowers/plans/2026-11-18-marketing-redesign-concept.md (prototype U69rCV4KB2N8BomkYUZzKL v3).
export const metadata: Metadata = {
  ...shareMetadata({
    ...genericSharePreview({ kind: "application", identifier: "", url: shareOrigin() + "/" }, "ready"),
    image: new URL("/og/home-card.png", shareOrigin()).href,
    imageAlt: "NetworkBase: pixel wordmark and the line Find your people. Build something together.",
  }),
  title: "NetworkBase — Find your people. Build something together.",
  description: "Discover workspaces, find people by skill, and bring tasks, files and conversations together.",
};

const SIX = TRAIL.colors;
const onColor = (bg: string) => (isLightHex(bg) ? "#141A1E" : "#FAF8F4");
const skillNames = (names: string[]) => names.map((name) => findCatalogSkill(name)?.name ?? name);

const navLinks = [["#how", "How it works"], ["#people", "People"], ["#workspace", "Workspace"], ["#classes", "Classes"], ["#terminal", "Terminal"]] as const;

const steps = [
  { label: "01 / Discover", icon: "search", title: "Find work you want to be part of.", body: "Browse workspaces by skills and interests. See the idea, the team and the roles they still need.", href: buildAuthPageHref("/signup", "/discover"), action: "Explore workspaces" },
  { label: "02 / Connect", icon: "people", title: "Meet people through what they do.", body: "Profiles are built around skills and contributions. Find people and start a conversation.", href: buildAuthPageHref("/signup", "/network"), action: "Meet people" },
  { label: "03 / Build", icon: "blocks", title: "Give your workspace a place to grow.", body: "Tasks, sprints, documents, files and messages live together, with clear roles for everyone.", href: buildAuthPageHref("/signup", "/workspaces/new"), action: "Create a workspace" },
] as const;

// Example content only, labelled as such on the page; skill names come from the real catalog.
const profiles = [
  { initials: "AK", name: "Aisha K.", headline: "Frontend developer", location: "Bengaluru", skills: skillNames(["React", "TypeScript", "Accessibility testing"]), shared: 3, color: "#A7C3F0" },
  { initials: "MR", name: "Marco R.", headline: "Product designer", location: "Lisbon", skills: skillNames(["Figma", "Design systems", "UX Research"]), shared: 5, color: "#EDBF85" },
  { initials: "JS", name: "Jun S.", headline: "Data engineer", location: "Singapore", skills: skillNames(["Python", "SQL", "Apache Airflow"]), shared: 2, color: "#99CEAD" },
  { initials: "LT", name: "Lena T.", headline: "Mobile developer", location: "Berlin", skills: skillNames(["Flutter", "Firebase", "Swift"]), shared: 4, color: "#F3A17E" },
];
const roles = [
  { title: "Frontend developer", workspace: "Design Studio 101", hours: "6 h a week", skills: skillNames(["React", "Accessibility testing"]) },
  { title: "Data engineer", workspace: "Campus Food Map", hours: "4 h a week", skills: skillNames(["Python", "SQL"]) },
  { title: "Mobile developer", workspace: "Study Buddy", hours: "8 h a week", skills: skillNames(["Flutter", "Firebase"]) },
];
const classSteps = [
  { title: "Create an organization", body: "Pick the kind: a class, a company team, a club or a lab. It sets the words and starting choices." },
  { title: "Invite by code or email", body: "Share one code with the class, or paste their emails. Everyone gets their own workspace and channels." },
  { title: "Assign and review", body: "Give work to everyone or to groups, then approve or return each hand-in from one queue." },
];
const terminal: [kind: "cmd" | "out" | "ok", text: string][] = [
  ["cmd", "npm i -g @networkbase/cli"], ["out", "added 1 package in 3s"],
  ["cmd", "nb login"], ["out", "Opening networkbase.in to approve this terminal…"], ["ok", "✓ Signed in"],
  ["cmd", "nb init design-studio"], ["ok", "✓ Linked this folder to Design Studio"],
  ["cmd", "nb status"], ["out", "2 tasks due this week · 1 overdue"],
  ["cmd", "nb next"], ["out", "→ Review the week 12 hand-ins"],
];

const ICONS = {
  search: { map: PIXEL_ICONS.search, color: "#2563C9" },
  people: { map: PIXEL_ICONS.people, color: "#D14E24" },
  blocks: { map: PIXEL_ICONS.blocks, color: "#2F6B4F" },
  lock: { map: PIXEL_ICONS.lock, color: "#2563C9" },
  shield: { map: PIXEL_ICONS.shield, color: "#D14E24" },
  download: { map: PIXEL_ICONS.download, color: "#2F6B4F" },
} satisfies Record<string, { map: readonly string[]; color: string }>;
function PixelIcon({ name }: { name: keyof typeof ICONS }) {
  const { map, color } = ICONS[name];
  return <svg className="pxicon" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true">
    {map.flatMap((row, y) => [...row].map((bit, x) => bit === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width=".92" height=".92" fill={color} /> : null))}
  </svg>;
}

// Release notes come from the CLI changelog when the page is built; the ticker hides if the file is missing.
function releaseNotes() {
  try { return parseReleaseNotes(readFileSync(join(process.cwd(), "packages/nb-cli/CHANGELOG.md"), "utf8")); } catch { return []; }
}

export default function HomePage() {
  const notes = releaseNotes();
  const first = WORKSPACE_MODULES[0];
  return <div className="nbh" id="nbh">
    <a href="#main-content" className="nb-skip-link">Skip to content</a>
    {notes[0] ? <div className="announce"><a href="#terminal">CLI {notes[0].version} · {notes[0].text} <span aria-hidden="true">↗</span></a></div> : null}
    <header className="nav" id="nbh-nav">
      <div className="nav-in">
        <a className="cell nav-logo" href="#main-content" aria-label="NetworkBase home"><span className="dot" aria-hidden="true" />NetworkBase</a>
        <nav className="nav-links" aria-label="Sections">{navLinks.map(([href, label]) => <a key={href} className="cell" href={href}>{label}</a>)}</nav>
        <span className="cell nav-count" aria-hidden="true"><b id="nbh-nav-n">01</b>&nbsp;/ 08 ·&nbsp;<span id="nbh-nav-sec">Start</span></span>
        <div className="nav-right">
          <a className="cell signin" href="/login">Sign in</a>
          <a className="cell nav-cta" href="/signup">Get started <span aria-hidden="true">↗</span></a>
          <button type="button" className="cell nav-menu" id="nbh-menu-btn" aria-expanded="false" aria-controls="nbh-menu">Menu</button>
        </div>
      </div>
      <div className="menu-panel" id="nbh-menu" hidden>
        {navLinks.map(([href, label]) => <a key={href} href={href}>{label}</a>)}<a href="/login">Sign in</a>
      </div>
    </header>

    <main className="frame" id="main-content" tabIndex={-1}>
      <section className="hero grid-ground" id="start" data-grid-trail="hero" data-trail-script="$ nb login|nb init|nb status|nb next" aria-labelledby="hero-title">
        <div className="wordmark" id="nbh-wordmark" aria-hidden="true" title="Click to retype">
          {[..."NetworkBase"].map((ch, i) => <span key={i} className="wm-letter" style={{ ["--i" as string]: i }}>{ch}</span>)}<span className="wm-cursor" id="nbh-wm-cursor" />
        </div>
        <div className="hero-split">
          <div className="hero-left">
            <p className="eyebrow" data-decode data-load style={{ ["--d" as string]: "300ms" }} id="nbh-hero-eyebrow">A place for people who build</p>
            <h1 className="hero-title serif" id="hero-title" data-load="clip" style={{ ["--d" as string]: "350ms" }}>Find your people. Build something together.</h1>
          </div>
          <div className="hero-right">
            <p className="lead" data-load style={{ ["--d" as string]: "450ms" }}>NetworkBase connects people who want to build with the workspaces that need them, then gives the team one place to plan, write, share and ship.</p>
            <div className="hero-actions" id="nbh-hero-ctas">
              <div className="row cta" data-cta-row data-load style={{ ["--d" as string]: "530ms" }}>
                <a className="btn primary" data-cta href="/signup">Get started <span aria-hidden="true">→</span></a>
                <a className="btn outline" href="#how">See how it works <span aria-hidden="true">↓</span></a>
              </div>
              <a className="cta-hint" href="#terminal" data-load style={{ ["--d" as string]: "610ms" }}><span className="p">$</span> nb login <span className="m">· prefer the terminal?</span></a>
            </div>
          </div>
        </div>
      </section>

      {/* LOCKED (18 Nov 2026): the pixel people band and its behaviour stay exactly as approved. */}
      <div className="band" id="nbh-band">
        <canvas id="nbh-band-canvas" aria-hidden="true" />
        <span className="band-label" aria-hidden="true">People building on NetworkBase · illustration · click one</span>
      </div>

      <section className="sec grid-ground" id="how" data-grid-trail="subtle" data-trail-script="nb status|nb next" aria-labelledby="how-title">
        <div className="sec-head">
          <div data-reveal><p className="eyebrow" data-decode>How it works</p><h2 className="title" id="how-title">The people, the workspace, and the work in between.</h2></div>
          <p className="lead" data-reveal style={{ ["--d" as string]: ".08s" }}>Three steps from an idea to a team that ships it together.</p>
        </div>
        <div className="cells c3">
          {steps.map((s, i) => <article key={s.label} className="step" data-reveal style={{ ["--d" as string]: `${i * 0.08}s` }}>
            <div className="step-top"><span className="step-label">{s.label}</span><PixelIcon name={s.icon} /></div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <a className="alink" href={s.href}>{s.action} <span aria-hidden="true">↗</span></a>
          </article>)}
        </div>
      </section>

      <section className="sec" id="people" aria-labelledby="people-title">
        <div className="people">
          <div className="people-copy" data-reveal>
            <p className="eyebrow" data-decode>Find people</p>
            <h2 className="title" id="people-title">Find people by what they can do.</h2>
            <p className="lead">Every profile shows skills, experience, weekly availability and the workspaces someone has worked on. Search by skill, or post an open role and let the right people find you.</p>
            <ul className="ticks">
              {["Search by skill, role and experience level", "See who is open to collaborate and how many hours they have", "Post open roles in your workspace", "Start a conversation from any profile"].map((t) => <li key={t}>{t}</li>)}
            </ul>
            <a className="alink" href={buildAuthPageHref("/signup", "/network")}>Meet people <span aria-hidden="true">↗</span></a>
          </div>
          <div className="profiles" aria-label="Example profiles">
            <p className="profiles-head">Example profiles · not real people</p>
            {profiles.map((p, i) => { const fill = SIX[(i * 2 + 1) % 6]!; return <article key={p.initials} className="pcard" data-reveal style={{ ["--d" as string]: `${i * 0.08}s`, ["--fill" as string]: fill, ["--on-fill" as string]: onColor(fill) }}>
              <div className="pcard-body">
                <div className="pcard-id"><span className="pav" style={{ background: p.color }} aria-hidden="true">{p.initials}</span><div><p className="pname">{p.name}</p><p className="pmeta">{p.headline}</p></div></div>
                <span className="open">Open to collaboration</span>
                <div className="chips">{p.skills.slice(0, 2).map((s) => <span key={s} className="chip">{s}</span>)}<span className="chip">+{p.skills.length - 2}</span></div>
              </div>
              <div className="pbar"><span>{p.location}</span><span>{p.shared} mutual</span></div>
            </article>; })}
            <div className="roles" data-reveal>
              <p className="roles-head">Example open roles · in the app these come from public workspaces</p>
              {roles.map((r) => <div key={r.title} className="role">
                <span className="rt">{r.title}</span><span className="rm">{r.workspace} · {r.hours}</span>
                <div className="chips">{r.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>
                <a className="alink" href={buildAuthPageHref("/signup", "/discover")}>View role <span aria-hidden="true">↗</span></a>
              </div>)}
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="workspace" aria-labelledby="ws-title">
        <div className="sec-head">
          <div data-reveal><p className="eyebrow" data-decode>Inside a workspace</p><h2 className="title" id="ws-title">Everything a workspace needs, in one place.</h2></div>
          <p className="lead" data-reveal style={{ ["--d" as string]: ".08s" }}>When the team comes together, the work has somewhere to live. No more scattered links, chats and spreadsheets.</p>
        </div>
        <div className="play" id="nbh-play" data-reveal>
          <div className="plist" role="tablist" aria-label="Workspace tools" aria-orientation="vertical">
            {WORKSPACE_MODULES.map((m, i) => <button key={m.key} type="button" className="pitem" role="tab" id={`nbh-tab-${m.key}`} data-key={m.key} aria-selected={i === 0} aria-controls="nbh-stage" tabIndex={i === 0 ? 0 : -1} style={{ ["--c" as string]: m.color }}>
              <span className="sw" /><span className="n">{String(i + 1).padStart(2, "0")}</span><span><span className="t">{m.title}</span></span><span className="path">{m.key}</span><span className="prog" />
            </button>)}
          </div>
          <div className={`stage ${isLightHex(first.color) ? "dark-text" : "light-text"}`} id="nbh-stage" role="tabpanel" aria-labelledby={`nbh-tab-${first.key}`} aria-live="polite" tabIndex={0} style={{ ["--stage" as string]: first.color }}>
            <div className="stage-top"><span id="nbh-stage-path">workspace / {first.key}</span><span className={`stage-ex${isLightHex(first.color) ? "" : " light"}`} id="nbh-stage-ex">Example</span></div>
            {WORKSPACE_MODULES.map(({ key, Mock }, i) => <div key={key} className="mock" data-mock={key} hidden={i > 0}><Mock /></div>)}
            <div className="stage-foot">
              {WORKSPACE_MODULES.map((m, i) => <div key={m.key} data-foot={m.key} hidden={i > 0}><h3>{m.title}</h3><p>{m.body}</p></div>)}
              <div className="stage-nav"><button type="button" className="sbtn" id="nbh-prev" aria-label="Previous tool">←</button><button type="button" className="sbtn" id="nbh-next" aria-label="Next tool">→</button></div>
            </div>
          </div>
        </div>
      </section>

      {notes.length ? <section className="ticker ink" aria-label="Recent releases">
        <div className="ticker-head">Release notes</div>
        <div className="ticker-track" tabIndex={0} aria-label="Release notes, scrolling">
          <div className="ticker-run" id="nbh-ticker">{notes.map((n, i) => <span key={n.version} className="tk" style={{ ["--c" as string]: SIX[(i * 2 + 1) % 6]! }}><b>{n.version}</b>{n.text}</span>)}</div>
        </div>
      </section> : null}

      <section className="sec grid-ground" id="classes" data-grid-trail="hero" data-trail-script="nb assignment|nb review-class" aria-labelledby="classes-title">
        <div className="sec-head">
          <div data-reveal><p className="eyebrow" data-decode>For classes and teams</p><h2 className="title" id="classes-title">Run a class or a team in one place.</h2></div>
          <p className="lead" data-reveal style={{ ["--d" as string]: ".08s" }}>An organization holds your people, their workspaces and the work you give them.</p>
        </div>
        <div className="cells c3">
          {classSteps.map((s, i) => <article key={s.title} className="cstep" data-reveal style={{ ["--d" as string]: `${i * 0.08}s` }}><span className="cnum">0{i + 1}</span><h3>{s.title}</h3><p>{s.body}</p></article>)}
        </div>
        <div className="classes-cta">
          <div className="row cta" data-cta-row>
            <a className="btn primary" data-cta href={buildAuthPageHref("/signup", "/workspaces/new?start=organization")}>Create an organization <span aria-hidden="true">→</span></a>
            <a className="alink" href="/help/running-a-class">Running a class on NetworkBase <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>

      <section className="ink grid-ground term-sec" id="terminal" data-grid-trail="hero" data-trail-script="$ nb login|nb init|nb pull|nb push" aria-labelledby="term-title">
        <div className="term-copy" data-reveal>
          <p className="eyebrow" data-decode>nb · the NetworkBase CLI</p>
          <h2 className="serif" id="term-title">Work from your terminal too.</h2>
          <p className="lead">Sign in, link a folder to a workspace, and see what to work on next without leaving your editor.</p>
          <div className="install"><span><span className="p">$</span> npm i -g @networkbase/cli</span>
            <button type="button" className="copy" id="nbh-copy-install" aria-label="Copy the install command" title="Copy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            </button>
          </div>
        </div>
        <div className="term-win" data-reveal style={{ ["--d" as string]: ".1s" }}>
          <div className="term-bar"><span>~/design-studio</span><span>Example session</span></div>
          <div className="term-body" id="nbh-term" aria-label="Example terminal session">
            {terminal.map(([kind, text], i) => <span key={i} data-kind={kind}>{kind === "cmd" ? <><span className="p">$</span> {text}</> : <span className={kind === "ok" ? "k" : "o"}>{text}</span>}{i < terminal.length - 1 ? "\n" : ""}</span>)}
            <span className="term-caret" aria-hidden="true" />
          </div>
        </div>
      </section>

      <section className="ink grid-ground" id="get-going" data-grid-trail="hero" data-trail-script="nb init|nb push" aria-labelledby="process-title">
        <div className="process">
          <div data-reveal><p className="eyebrow" data-decode>A practical way to get going</p><h2 className="serif" id="process-title" style={{ marginTop: 18 }}>Make room for your next idea.</h2><p className="lead" style={{ marginTop: 18 }}>Start small, find the people who care about the same problem, and build your way forward.</p></div>
          <ol className="psteps" data-reveal style={{ ["--d" as string]: ".08s" }}>
            {["Set up your profile and add your skills.", "Find a workspace or create one of your own.", "Invite members and agree on the next steps.", "Share your progress as the work takes shape."].map((t, i) => <li key={t}><b>0{i + 1}</b><span>{t}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="sec" aria-labelledby="trust-title">
        <h2 className="sr-only" id="trust-title">Privacy and security</h2>
        <div className="trust">
          {([["lock", "You choose who sees your profile", "Set your visibility and who can contact you."], ["shield", "Two-step verification", "Protect your account with an authenticator app."], ["download", "Your data stays yours", "Export it or delete your account at any time."]] as const).map(([icon, title, body], i) =>
            <div key={title} data-reveal style={{ ["--d" as string]: `${i * 0.08}s` }}><PixelIcon name={icon} /><div><h3>{title}</h3><p>{body}</p></div></div>)}
        </div>
        <p className="legal-line">Read the <a href="/privacy">Privacy Policy</a> or <a href="/security-reporting">report a security issue</a>.</p>
      </section>

      <section className="final grid-ground" id="join" data-grid-trail="hero" data-trail-script="nb init|nb push|nb next" aria-labelledby="final-title">
        <h2 className="serif" id="final-title" data-reveal>Your work says more when you build it together.</h2>
        <div className="row cta" data-cta-row data-reveal style={{ ["--d" as string]: ".1s" }}><a className="btn primary" data-cta href="/signup">Get started <span aria-hidden="true">→</span></a><a className="btn outline" href="/login">Sign in</a></div>
      </section>
    </main>

    <footer className="ink grid-ground foot" data-grid-trail="hero" data-trail-script="cd ~|nb status" data-pixel-word="NETWORKBASE" data-word-align="center">
      <div className="frame" style={{ borderColor: "var(--ink-line)" }}>
        <div data-pixel-slot aria-hidden="true" />
        <p className="foot-fallback" aria-hidden="true">NetworkBase</p>
        <div className="foot-cols">
          <div><span className="nav-logo" style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600, fontSize: 17 }}><span className="dot" aria-hidden="true" />NetworkBase</span><p style={{ color: "var(--ink-muted)", maxWidth: "36ch" }}>Find people, join workspaces and work together.</p></div>
          <nav aria-label="Product"><span className="h">Product</span>{navLinks.slice(0, 4).map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
          <nav aria-label="Account"><span className="h">Account</span><a href="/login">Sign in</a><a href="/signup">Get started</a><a href="/docs/cli">Command-line tool</a></nav>
        </div>
        <div className="foot-legal"><span>© 2026 NetworkBase</span><nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/security-reporting">Security</a><a href="/cookies">Cookies</a></nav></div>
      </div>
    </footer>

    <div className="mbar" id="nbh-mbar"><a className="btn primary" href="/signup">Get started <span aria-hidden="true">→</span></a><a className="mlink" href="/login">Sign in</a></div>
    <HomeEffects />
  </div>;
}
