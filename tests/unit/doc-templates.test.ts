import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.15 D6 (plan A6.1): NetworkBase document templates under Start from.
test("templates: unique ids, known groups, a one-line purpose, a body that starts with the title", async () => {
  const { DOC_TEMPLATES, TEMPLATE_GROUPS, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const ids = DOC_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of DOC_TEMPLATES) {
    assert.ok(TEMPLATE_GROUPS.some((g) => g.id === t.group), t.id);
    assert.ok(t.line.length > 0 && t.line.length <= 90, t.id);
    assert.match(templateBody(t, "Sign-in"), /^# .+\n/, t.id);
  }
});

test("templateFileName and the title line: “Tech spec – Sign-in.md”; no title → the template's name", async () => {
  const { templateFileName, templateTitle } = await import("../../src/lib/workflows/doc-templates");
  assert.equal(templateTitle("Assumptions check", "Pricing"), "Assumptions check – Pricing");
  assert.equal(templateTitle("Assumptions check", "  "), "Assumptions check");
  assert.equal(templateFileName("Assumptions check", "Pricing / v2"), "Assumptions check – Pricing v2.md");
});

test("parked parts say when they arrive (call 2)", async () => {
  const { parked } = await import("../../src/lib/workflows/doc-templates");
  assert.equal(parked("Money"), "> Available when Money is added.");
});

test("Assumptions check (11.8): intro, then the table with its columns and the words for Evidence and Status", async () => {
  const { templateById, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const md = templateBody(templateById("assumptions-check")!, "Pricing");
  assert.match(md, /^# Assumptions check – Pricing\n\n_What has to be true for this to work\?/);
  assert.match(md, /\| Assumption \| Depends on \| Evidence \| If it’s wrong, what breaks \| Cheapest test \| Status \|\n\|---\|---\|---\|---\|---\|---\|/);
  assert.match(md, /Evidence: None · Weak · Strong\. Status: Untested · Testing · Holds · Broken\./);
});

const heads = (md: string, level = "## ") => md.split("\n").filter((l) => l.startsWith(level)).map((l) => l.slice(level.length));
test("Startup group (11.8, 20.7): headings as their sources list them", async () => {
  const { templateById, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const md = (id: string) => templateBody(templateById(id)!, "");
  assert.deepEqual(heads(md("value-proposition")), ["Customer", "Our offer", "Fit check"]);
  assert.deepEqual(heads(md("value-proposition"), "### "), ["Jobs", "Pains", "Gains", "Products and services", "Pain relievers", "Gain creators"]);
  assert.deepEqual(heads(md("business-model-canvas")), ["Key partners", "Key activities", "Key resources", "Value propositions", "Customer relationships", "Channels", "Customer segments", "Cost structure", "Revenue streams"]);
  assert.deepEqual(heads(md("investor-update")), ["TL;DR", "Key numbers", "Highlights", "Lowlights", "Asks", "Hiring", "Runway"]);
  assert.deepEqual(heads(md("business-plan")), ["Summary", "Problem", "Solution", "Market", "Business model", "Go to market", "Team", "Financials", "Ask"]);
  assert.match(md("business-plan"), /## Financials\n> Available when Money is added\./);
});

test("Clients and creative group (12.5, 24.7, 14.7): headings and parked parts", async () => {
  const { templateById, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const md = (id: string) => templateBody(templateById(id)!, "");
  assert.deepEqual(heads(md("client-report")), ["Summary", "Progress", "Work completed", "Time", "Results", "Blockers", "Decisions needed", "Next steps"]);
  assert.match(md("client-report"), /## Time\n> Available when Money is added\./);
  assert.deepEqual(heads(md("creative-brief")), ["Problem", "Audience", "Message", "Deliverables", "Sizes", "Mandatory items", "References", "Deadline"]);
  assert.deepEqual(heads(md("case-study")), ["Problem", "My role", "Process", "Decisions", "Result", "Images"]);
  assert.deepEqual(heads(md("brand-guide")), ["About us", "Mission · Vision · Values", "Logos", "Colors", "Typography", "Tone of voice", "Usage rules"]);
  assert.deepEqual(heads(md("brand-questionnaire")), ["About you", "Personality", "Look and feel", "Practical"]);
});

test("Product and engineering group (13.4, 13.5, 20.2, 20.3, 20.6, 21.2, 21.5): headings and blocks", async () => {
  const { templateById, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const md = (id: string) => templateBody(templateById(id)!, "");
  assert.deepEqual(heads(md("tech-spec")), ["Problem statement", "Proposed solution", "Alternatives", "Rollout plan", "Decisions"]);
  assert.deepEqual(parseLiveBlocks(md("tech-spec")).map((b) => b.kind), ["decisions"]);
  assert.deepEqual(heads(md("api-docs")), ["Overview", "Authentication", "Rate limits", "Errors", "Endpoints", "Changes"]);
  assert.match(md("api-docs"), /```json\n\{\}\n```/);
  assert.deepEqual(heads(md("prd")), ["Objective", "User personas", "Success metrics", "Requirements", "User stories", "MVP scope", "Assumptions", "Dependencies", "Timeline", "Open questions", "Supporting docs"]);
  assert.deepEqual(heads(md("persona")), ["Who they are", "Goals", "Frustrations", "Jobs to be done", "Real quotes"]);
  assert.deepEqual(heads(md("postmortem")), ["Description", "Timeline", "Root cause", "Resolution", "Actions taken", "Lessons learned", "Recommendations"]);
  assert.deepEqual(parseLiveBlocks(md("postmortem")).map((b) => [b.kind, b.key]), [["task_rows", "actions"]]);
  assert.match(md("test-plan"), /\| Case \| Steps \| Expected \| Result \| Tester \| Date \|/);
  assert.ok(heads(md("faq")).length >= 3);
});

test("Content group (14.4–14.6, 18.7, 19.4, 19.7): headings as their sources list them", async () => {
  const { templateById, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const md = (id: string) => templateBody(templateById(id)!, "");
  assert.deepEqual(heads(md("blog-post")), ["Body", "Sources", "SEO"]);
  assert.deepEqual(heads(md("newsletter")), ["Intro", "Main story", "Links worth your time", "From us", "Sign-off"]);
  assert.deepEqual(heads(md("content-brief")), ["Outline", "Key points", "Sources", "Call to action"]);
  assert.deepEqual(heads(md("show-notes")), ["Summary", "Guest", "Chapters", "Links mentioned", "Sponsor", "Transcript"]);
  assert.deepEqual(heads(md("episode-run-sheet")), ["Intro", "Segments", "Questions", "Ad breaks", "Outro"]);
  assert.deepEqual(heads(md("sponsor-read")), ["Product", "Talking points", "Words to avoid", "Call to action", "Link"]);
  assert.deepEqual(heads(md("video-script")), ["Hook", "Intro", "Main points", "Call to action", "Outro"]);
  assert.deepEqual(heads(md("beat-sheet")), ["Beats", "Scenes"]);
  assert.match(heads(md("short-film-script"))[0]!, /^INT\. /);
  assert.deepEqual(heads(md("call-sheet")), ["Location", "Crew", "Cast", "Shots to get", "Weather and notes"]);
});

test("Learning, Non-profit, Games (15.3, 17.7, 22.2, 24.4) and the full list of 32", async () => {
  const { DOC_TEMPLATES, templateById, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const md = (id: string) => templateBody(templateById(id)!, "");
  assert.deepEqual(heads(md("class-notes")), ["Cues", "Notes", "Summary"]);
  assert.deepEqual(heads(md("grant-proposal")), ["Summary", "Need", "Program", "Outcomes", "Budget", "About us", "Evaluation", "Attachments"]);
  assert.deepEqual(heads(md("impact-report")), ["A letter", "Numbers", "Stories", "Finances", "Thank you"]);
  assert.deepEqual(heads(md("game-design-document")), ["Overview", "High level", "Features", "Detail docs", "Moodboard"]);
  assert.deepEqual(heads(md("character-profile")), ["Portrait", "Basics", "Appearance", "Personality", "Backstory", "Relationships", "Quotes", "Art references"]);
  assert.deepEqual(heads(md("reviews-and-response")), ["Reviewer 1", "Reviewer 2", "Summary of changes"]);
  assert.equal(DOC_TEMPLATES.length, 38, "every template of 26.3, plus the Syllabus (30.2), the company Handbook page and Process (33.2), the lab Protocol and Data management plan (35.5), and Reviews and response (35.3)");
});
