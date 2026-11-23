/**
 * Every workflow the Add workflow dialog lists (report 38.2 F1, lines from each round's "Getting it"). `built` turns on
 * when the workflow's round ships; until then it shows under "Later · parked" and can't be added (F1 call 10).
 */
export type WorkflowGroup = "tasks" | "own_tab" | "documents" | "files" | "updates" | "sprints" | "parked";

export const WORKFLOW_GROUPS: Array<{ id: WorkflowGroup; label: string }> = [
  { id: "tasks", label: "Blends into Tasks" },
  { id: "own_tab", label: "Own tab · same tasks" },
  { id: "documents", label: "Blends into Documents" },
  { id: "files", label: "Blends into Files" },
  { id: "updates", label: "Blends into Updates" },
  { id: "sprints", label: "Blends into Sprints" },
  { id: "parked", label: "Later · parked" },
];

export type CatalogEntry = {
  id: string;
  name: string;
  group: Exclude<WorkflowGroup, "parked">;
  line: string;
  /** Lucide icon name. */
  icon: string;
  /** Item types it adds (src/lib/workflows/types.ts). */
  types: string[];
  /** An own tab's id in the tab row. */
  tab?: string;
  built: boolean;
};

export const WORKFLOW_CATALOG: CatalogEntry[] = [
  { id: "project_planner", name: "Project planner", group: "tasks", icon: "ChartGantt", types: ["project"], built: true, line: "Adds to Tasks: a Projects view with a Timeline. Tasks get Part of." },
  { id: "bugs", name: "Bugs", group: "own_tab", icon: "Bug", types: ["bug"], tab: "bugs", built: true, line: "Adds a Bugs tab. Bugs join Tasks at Fixing." },
  { id: "requests", name: "Requests", group: "own_tab", icon: "Inbox", types: ["request"], tab: "requests", built: true, line: "Adds a Requests tab. People ask; accepted requests join Tasks at Accepted." },
  { id: "content", name: "Content", group: "own_tab", icon: "PenLine", types: ["content"], tab: "content", built: true, line: "Adds a Content tab. Pieces join Tasks at Drafting." },
  { id: "roadmap", name: "Roadmap", group: "own_tab", icon: "Map", types: ["roadmap_item"], tab: "roadmap", built: true, line: "Adds a Roadmap tab: what ships Now, Next and Later. Its work tasks go on the board." },
  { id: "launches", name: "Launch checklists", group: "documents", icon: "Rocket", types: [], built: true, line: "Adds a Launches section to Documents. Every checklist step is a task." },
  { id: "meetings", name: "Meetings and decisions", group: "documents", icon: "CalendarClock", types: [], built: false, line: "Adds Meetings and Decisions sections with meeting types." },
  { id: "goals", name: "Quarterly goals", group: "documents", icon: "Target", types: ["objective", "key_result"], built: false, line: "Adds a Goals section with one goals document per quarter." },
  { id: "ideas", name: "Ideas", group: "documents", icon: "Lightbulb", types: ["idea"], built: false, line: "Adds an Ideas section with a ranked list." },
  { id: "offsite", name: "Team off-site", group: "documents", icon: "Tent", types: [], built: false, line: "Adds an Off-site section: plan a team trip in one document." },
  { id: "assets", name: "Assets", group: "files", icon: "Images", types: [], built: false, line: "Adds an Assets view to Files with details, Used in and pinned comments." },
  { id: "changelog", name: "Changelog and scheduled Updates", group: "updates", icon: "Megaphone", types: [], built: false, line: "Adds a Changelog view and lets Updates post at a set time." },
  { id: "learning_path", name: "Learning path", group: "sprints", icon: "Route", types: ["class_lesson"], built: false, line: "Adds a Path view to Sprints. Steps can be undated; everyone ticks their own lessons." },
];

/** Parked in report 28.2 and plan section 8: listed so people see what's coming, never addable. */
export const PARKED_WORKFLOWS = [
  "Pipeline", "Client portal", "Feedback page", "Support inbox", "Incidents and Status page", "Event planner",
  "Course planner", "Goals and OKRs", "Inventory and orders", "Money",
];

export const catalogEntry = (id: string) => WORKFLOW_CATALOG.find((entry) => entry.id === id) ?? null;

/**
 * Report section 6, in its order, with each old tab name read as the workflow it blended into (28.2): Bug tracker →
 * Bugs, Feedback & requests → Requests, Roadmap & launches → Roadmap, Content calendar → Content, Asset library →
 * Assets, Meetings & decisions → Meetings, Goals & OKRs → Quarterly goals. Parked ones (Pipeline, Money, Inventory,
 * Course planner, Event planner) are left out.
 */
const SUGGESTIONS: Record<string, string[]> = {
  side_project: ["roadmap"],
  startup: ["project_planner", "goals", "roadmap", "meetings"],
  open_source: ["bugs", "requests", "project_planner", "meetings"],
  hackathon: ["project_planner"],
  creative: ["assets"],
  nonprofit: ["goals"],
  game: ["project_planner", "roadmap", "bugs", "assets"],
  web_app: ["bugs", "requests", "roadmap", "project_planner"],
  ecommerce: ["content"],
  tool: ["bugs", "requests", "project_planner"],
  content: ["content", "assets"],
  podcast: ["content", "assets"],
  video: ["content", "assets", "project_planner"],
};

/** The wizard's Workflows section (W9): the category's built suggestions, only the first ticked (decision 5). */
export function suggestedWorkflows(category: string | null | undefined) {
  return (SUGGESTIONS[category ?? ""] ?? []).filter((id) => catalogEntry(id)?.built).map((workflow, i) => ({ workflow, ticked: i === 0 }));
}
