import { liveBlockLine } from "@/lib/workspaces/doc-live-blocks";

/**
 * Report 38.10 D2 (plan A3.1): Launch checklists. A launch is a document in the Launches section (F2) with a date, a
 * stage and one task-rows block per checklist stage; its steps are real tasks. Presets are data here (call 3): each
 * stage becomes a heading and a block whose key is fixed, so the steps land in the right block.
 */
export const LAUNCH_STAGES = ["planning", "getting_ready", "launched", "closed", "cancelled"] as const;
export type LaunchStage = (typeof LAUNCH_STAGES)[number];
export const LAUNCH_STAGE_LABEL: Record<LaunchStage, string> = { planning: "Planning", getting_ready: "Getting ready", launched: "Launched", closed: "Closed", cancelled: "Canceled" };

export type LaunchPreset = { id: string; name: string; stages: Array<{ name: string; why?: string; steps: string[] }> };
/** A3.1 ships Blank; A3.2–A3.8 add the other presets, one unit each (11.5: each stage has a one-line why and a few starter steps). */
export const LAUNCH_PRESETS: LaunchPreset[] = [
  // A3.2 (11.5, from Notion's product launch checklist).
  { id: "product", name: "Product launch", stages: [
    { name: "Market research", why: "Who it’s for and what they need.", steps: ["Create buyer personas", "Competitive analysis", "Talk to five target customers"] },
    { name: "Goal identification", why: "What a good launch looks like, in numbers.", steps: ["Set the launch goal and how it’s measured", "Agree the launch date"] },
    { name: "Marketing plan", why: "How people will hear about it.", steps: ["Write the positioning and key message", "Pick the launch channels", "Draft the launch post"] },
    { name: "Sales and support training", why: "Everyone who talks to customers knows what’s new.", steps: ["Brief support on what’s new", "Write the help articles and FAQ"] },
    { name: "Testing and beta testing", why: "Real people use it before everyone does.", steps: ["Run a beta with early users", "Fix launch-blocking bugs"] },
    { name: "Launch day", why: "Ship it and tell people.", steps: ["Release to everyone", "Post the announcement", "Watch for problems"] },
    { name: "After launch", why: "Learn from it.", steps: ["Check the launch goal", "Collect feedback", "Write the retrospective"] },
  ] },
  // A3.3 (11.5).
  { id: "feature", name: "Feature release", stages: [
    { name: "Build done", why: "It works end to end.", steps: ["Finish the last pull request", "Turn on the feature for the team"] },
    { name: "QA", why: "It holds up before people rely on it.", steps: ["Test the main paths", "Fix launch-blocking bugs"] },
    { name: "Docs", why: "People can find out how it works.", steps: ["Update the help article", "Write the changelog line"] },
    { name: "Announce", why: "The people who asked for it hear about it.", steps: ["Post the Update", "Tell the people who asked"] },
    { name: "Watch", why: "Catch what breaks early.", steps: ["Watch errors and feedback for a week"] },
  ] },
  // A3.4 (20.4).
  { id: "app", name: "App release", stages: [
    { name: "Build and test", why: "Internal and beta testing.", steps: ["Internal test build", "Beta with testers"] },
    { name: "Store listing", why: "What people see before they install.", steps: ["Screenshots", "Description", "Keywords"] },
    { name: "Privacy", why: "What the stores ask about data.", steps: ["Store privacy labels", "Data-safety form", "Privacy policy link"] },
    { name: "Submit for review", why: "Leave time for the store’s review.", steps: ["Submit to the App Store", "Submit to Google Play"] },
    { name: "Release", why: "A staged rollout catches problems early.", steps: ["Start the staged rollout", "Release to everyone"] },
    { name: "After release", why: "Keep an eye on it.", steps: ["Answer store reviews", "Watch the crash rate", "Plan a hotfix if needed"] },
  ] },
  // A3.5 (22.4), grouped by when; NetworkBase never publishes to a store.
  { id: "store", name: "Store launch", stages: [
    { name: "3+ months before", why: "Wishlists take time to build.", steps: ["Store page", "Capsule art", "Trailer", "Wishlist campaign"] },
    { name: "1 month before", why: "Press and creators need time to play.", steps: ["Press kit", "Review keys", "Demo"] },
    { name: "Launch week", why: "Be there when people arrive.", steps: ["Release", "Announce", "Answer the first reviews"] },
    { name: "After launch", why: "Keep it going.", steps: ["Patches", "Reviews", "Sale planning"] },
  ] },
  // A3.6 (25.5).
  { id: "digital", name: "Digital product launch", stages: [
    { name: "Make", why: "The thing people buy is ready.", steps: ["Check the files", "Preview images"] },
    { name: "Listing", why: "What people see before they buy.", steps: ["Title", "Description", "Tags", "Price"] },
    { name: "Launch", why: "Tell people it’s out.", steps: ["Plan the announcement in Content", "Post an Update"] },
    { name: "After", why: "Look after the people who bought it.", steps: ["Read the first reviews", "Note updates in the changelog", "Answer support questions"] },
  ] },
  // A3.7 (11.5; Podcast and Video reuse it later).
  { id: "content", name: "Content launch", stages: [
    { name: "Script", why: "Know what you’ll say.", steps: ["Outline", "Write the script"] },
    { name: "Record", why: "Get it down.", steps: ["Record", "Back up the raw files"] },
    { name: "Edit", why: "Make it tight.", steps: ["Edit", "Captions"] },
    { name: "Publish", why: "Put it out.", steps: ["Thumbnail and title", "Publish"] },
    { name: "Promote", why: "Help people find it.", steps: ["Share on your channels", "Reply to comments"] },
  ] },
  // A3.8 (11.5).
  { id: "blank", name: "Blank", stages: [{ name: "Checklist", steps: [] }] },
];
export const launchPreset = (id: string) => LAUNCH_PRESETS.find((p) => p.id === id) ?? null;

/** A stage's block key, fixed by its place in the preset (a launch's blocks are made once, from its preset). */
export const stageBlockKey = (index: number) => `launch${index + 1}`;

/** W1: the new launch document: the name, then one heading and one task-rows block per stage, then What's new. */
export function launchMarkdown(preset: LaunchPreset, name: string) {
  const stages = preset.stages.map((s, i) => `## ${i + 1}. ${s.name}\n\n${s.why ? `_${s.why}_\n\n` : ""}${liveBlockLine("task_rows", stageBlockKey(i), s.name)}\n`);
  return `# ${name}\n\n${stages.join("\n")}\n## What’s new\n\n### Added\n\n### Improved\n\n### Fixed\n`;
}

/** S1: "14 of 31 steps", canceled steps not counted; none at all says so. */
export function launchProgress(steps: Array<{ status: string; stage?: string | null }>) {
  const counted = steps.filter((s) => s.stage !== "cancelled");
  const done = counted.filter((s) => s.status === "done").length;
  return { done, total: counted.length, text: counted.length ? `${done} of ${counted.length} steps` : "No steps" };
}

/** W2: the first step leaving To do moves Planning to Getting ready; nothing else moves by itself. */
export const stageAfterStepStarted = (stage: LaunchStage | undefined) => (!stage || stage === "planning" ? "getting_ready" as const : null);

/** S1 countdown: "in 23 days", "today", "3 days ago", or "Launched Dec 12". */
export function countdown(date: string, today: string, launchedAt?: string | null) {
  if (launchedAt) return `Launched ${new Date(launchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days === 0 ? "today" : days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : `${-days} ${days === -1 ? "day" : "days"} ago`;
}

/** W4: What's new from what ships (Feature → Added, Improvement → Improved) and bugs Fixed in this version (call 5). */
export function whatsNew(items: Array<{ title: string; itemType?: string | null }>, bugs: Array<{ title: string; fixedIn?: string | null }>, versionLabel: string | null) {
  const v = versionLabel?.trim().toLowerCase();
  return {
    added: items.filter((i) => (i.itemType ?? "feature") === "feature").map((i) => i.title),
    improved: items.filter((i) => i.itemType === "improvement").map((i) => i.title),
    fixed: [...items.filter((i) => i.itemType === "fix").map((i) => i.title), ...(v ? bugs.filter((b) => b.fixedIn?.trim().toLowerCase() === v).map((b) => b.title) : [])],
  };
}

/** W7: steps' due dates moved with the launch; undated steps stay undated. */
export function shiftDates<T extends { dueDate: string | null }>(steps: T[], days: number) {
  return steps.map((s) => ({ ...s, dueDate: s.dueDate ? new Date(Date.parse(`${s.dueDate.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) : null }));
}

/** W6 and call 6: Close is suggested 14 days after launching; nothing closes by itself. */
export const closeSuggested = (launchedAt: string | null | undefined, now: Date) => Boolean(launchedAt) && now.getTime() - Date.parse(launchedAt!) >= 14 * 86_400_000;
