/**
 * Report 38.15 D6 (plan A6.1): NetworkBase document templates, offered under New document → Start from. Each is Markdown
 * text in code with a group and a one-line purpose; A6.2–A6.33 add one template each, from its source section. They
 * live here as text (not files read at run time) so the browser and the server share them.
 */
export const TEMPLATE_GROUPS = [
  { id: "startup", label: "Startup and business" },
  { id: "clients", label: "Clients and creative" },
  { id: "product", label: "Product and engineering" },
  { id: "content", label: "Content" },
  { id: "learning", label: "Learning" },
  { id: "nonprofit", label: "Non-profit" },
  { id: "games", label: "Games and stories" },
] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number]["id"];

export type DocTemplate = { id: string; name: string; group: TemplateGroup; line: string; body: string };

/** Call 2: parts that need a parked tab say when they arrive. */
export const parked = (tab: string) => `> Available when ${tab} is added.`;

export const DOC_TEMPLATES: DocTemplate[] = [
  // 11.8: Business Model Contradiction Finder + Venture Assumption Dependency Map, merged.
  { id: "assumptions-check", name: "Assumptions check", group: "startup", line: "What has to be true, what it depends on, and the cheapest test.",
    body: `_What has to be true for this to work? List each assumption, what it depends on, and the cheapest way to find out._

| Assumption | Depends on | Evidence | If it's wrong, what breaks | Cheapest test | Status |
|---|---|---|---|---|---|
| Schools will pay per seat | Teachers want it | Weak | Pricing, revenue plan | 5 calls with heads of IT | Testing |
|  |  |  |  |  | Untested |

_Evidence: None · Weak · Strong. Status: Untested · Testing · Holds · Broken. An assumption others depend on is load-bearing: test it first._
` },
];

export const templateById = (id: string) => DOC_TEMPLATES.find((t) => t.id === id) ?? null;
export const templateTitle = (name: string, title: string) => (title.trim() ? `${name} – ${title.trim()}` : name);
/** W1: "/Docs/Tech spec – Sign-in.md" (slashes and other path characters dropped from the title). */
export const templateFileName = (name: string, title: string) => `${templateTitle(name, title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " "))}.md`;
export const templateBody = (t: DocTemplate, title: string) => `# ${templateTitle(t.name, title)}\n\n${t.body}`;
