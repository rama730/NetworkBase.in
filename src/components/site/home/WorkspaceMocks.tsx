import { TRAIL, isLightHex } from "@/lib/grid-trail";

// Small example screens for the "Inside a workspace" tour. Example content only, labelled as such on the stage.
const SIX = TRAIL.colors;
const on = (bg: string) => (isLightHex(bg) ? "#141A1E" : "#FAF8F4");

function Tasks() {
  const cols: [string, string[]][] = [["To do", ["Write onboarding copy", "Pick chart colors"]], ["Doing", ["Profile card layout", "Invite flow"]], ["Done", ["Grid tokens", "Sign-in panel", "Skill search"]]];
  return <>
    <div className="mrow" style={{ justifyContent: "space-between" }}><span className="mt">Sprint 12 · Week of 16 Nov</span><span className="mm">7 tasks</span></div>
    <div className="cols3">
      {cols.map(([head, items], k) => <div key={head} className="kcol"><span className="mm">{head} · {items.length}</span>
        {items.map((t, n) => { const c = SIX[(k * 2 + n) % 6]!; return <div key={t} className="kcard"><span className="mt" style={{ fontSize: 12 }}>{t}</span><span className="tag" style={{ background: c, color: on(c) }}>{["design", "copy", "build"][(k + n) % 3]}</span></div>; })}
      </div>)}
    </div>
  </>;
}

function Docs() {
  return <>
    <span className="mm">docs / onboarding-spec</span>
    <span className="mt" style={{ fontSize: 20, fontFamily: "var(--serif)", fontWeight: 400 }}>Onboarding: first week</span>
    <div className="mbar" style={{ width: "92%" }} /><div className="mbar" style={{ width: "84%" }} /><div className="mbar" style={{ width: "60%" }} />
    <span className="mt" style={{ marginTop: 6 }}>Decisions</span>
    {["Use one invite code per class", "Send the welcome email after the first sign-in", "Show example tasks until the first real one"].map((t, i) =>
      <div key={t} className="mrow"><span style={{ width: 12, height: 12, background: i < 2 ? "#2F6B4F" : "#DBD5C8", flex: "none" }} /><span style={{ fontSize: 13 }}>{t}</span></div>)}
  </>;
}

function Files() {
  const files: [string, string, string][] = [["hero.fig", "FIG", "#D14E24"], ["logo.svg", "SVG", "#2563C9"], ["notes.md", "MD", "#2F6B4F"], ["api.ts", "TS", "#2563C9"], ["brief.pdf", "PDF", "#D14E24"], ["photo.png", "PNG", "#EDBF85"]];
  return <>
    <div className="mrow" style={{ justifyContent: "space-between" }}><span className="mm">files / design</span><span className="mm">6 files</span></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
      {files.map(([name, ext, c]) => <div key={name} className="ftile"><span className="fext" style={{ background: c, color: on(c) }}>{ext}</span><div className="mbar" style={{ height: 36, background: "#F3F0EA" }} /><span className="mm">{name}</span></div>)}
    </div>
  </>;
}

function Updates() {
  const posts: [string, string, string, string][] = [["MR", "Marco R.", "Shipped the new profile cards. Feedback welcome before Friday.", "#EDBF85"], ["AK", "Aisha K.", "Accessibility pass done on the sign-in pages: 0 issues left.", "#A7C3F0"]];
  return <>{posts.map(([i, n, t, c]) =>
    <div key={i} style={{ border: "1px solid #DBD5C8", padding: 12, display: "grid", gap: 8 }}>
      <div className="mrow"><span className="pav" style={{ width: 28, height: 28, fontSize: 11, background: c }}>{i}</span><span className="mt">{n}</span><span className="mm">· 2h</span></div>
      <p style={{ fontSize: 14 }}>{t}</p>
      <div className="mrow"><span className="mm">♡ 4</span><span className="mm">↳ 2 replies</span></div>
    </div>)}</>;
}

function Messages() {
  return <>
    <div className="mrow" style={{ justifyContent: "space-between" }}><span className="mt"># design-studio</span><span className="mm">5 members</span></div>
    <div className="bub">Can someone review the invite flow today?</div><div className="bub me">On it after lunch.</div><div className="bub">Thanks! Notes are in the doc.</div>
    <div className="mm" style={{ marginTop: "auto", border: "1px solid #DBD5C8", padding: 10 }}>Message #design-studio</div>
  </>;
}

function Dashboard() {
  return <>
    <div className="mrow" style={{ justifyContent: "space-between" }}><span className="mt">Tasks done per week</span><span className="mm">last 12 weeks</span></div>
    <div className="bars">{[3, 5, 4, 7, 6, 8, 5, 9, 7, 10, 8, 12].map((v, i) => <i key={i} style={{ height: `${v * 8}%`, ["--c" as string]: i === 11 ? "#D14E24" : "#99CEAD" }} />)}</div>
    <div className="mrow" style={{ justifyContent: "space-between" }}><span className="mm">12 this week</span><span className="mm">example data</span></div>
  </>;
}

function Roles() {
  const roles: [string, string, number][] = [["Owner", "Manage, edit, view", 1], ["Editor", "Edit and view", 2], ["Viewer", "View only", 3]];
  return <>
    {roles.map(([r, d, n]) => <div key={r} className="mrow" style={{ justifyContent: "space-between", borderBottom: "1px solid #DBD5C8", padding: "10px 0" }}>
      <div><span className="mt">{r}</span><p className="mm">{d}</p></div><span className="mm">{n} {n === 1 ? "person" : "people"}</span>
    </div>)}
    <span className="mm">Invite links can set a role.</span>
  </>;
}

function Editor() {
  return <div className="code"><b>$</b> nb init design-studio{"\n"}<s>✓</s> Linked this folder to Design Studio{"\n"}<b>$</b> nb pull{"\n"}<s>✓</s> 6 files up to date{"\n"}<em>src/</em>onboarding.ts   <s>synced</s>{"\n"}<em>docs/</em>spec.md       <s>synced</s></div>;
}

export const WORKSPACE_MODULES = [
  { key: "tasks", title: "Tasks and sprints", body: "Plan the work, assign it, and see what moves each sprint.", color: "#EDBF85", Mock: Tasks },
  { key: "docs", title: "Documents", body: "Specs, notes and decisions, written next to the work.", color: "#A7C3F0", Mock: Docs },
  { key: "files", title: "Files", body: "One place for designs, code and assets, with previews.", color: "#99CEAD", Mock: Files },
  { key: "updates", title: "Updates", body: "Share progress with your team and the people following along.", color: "#F3A17E", Mock: Updates },
  { key: "messages", title: "Messages", body: "Channels and direct messages for every workspace.", color: "#2563C9", Mock: Messages },
  { key: "dashboard", title: "Dashboard", body: "Activity, progress and contributions at a glance.", color: "#2F6B4F", Mock: Dashboard },
  { key: "roles", title: "Roles and permissions", body: "Decide who can view, edit and manage each workspace.", color: "#D14E24", Mock: Roles },
  { key: "editor", title: "Editor sync", body: "Work on workspace files and tasks from VS Code, Cursor or Windsurf.", color: "#141A1E", Mock: Editor },
] as const;
