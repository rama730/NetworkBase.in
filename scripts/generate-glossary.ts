import fs from "node:fs";

import * as terms from "../src/lib/copy/terms";

/** Writes docs/glossary.md from src/lib/copy/terms.ts (report §14.7). Run after changing terms.ts. */
const table = (title: string, rows: Array<[string, string]>) =>
  `## ${title}\n\n| Stored value | Shown as |\n|---|---|\n${rows.map(([k, v]) => `| \`${k}\` | ${v} |`).join("\n")}\n`;
const list = (title: string, rows: ReadonlyArray<{ label: string; description?: string }>) =>
  `## ${title}\n\n${rows.map((r) => `- **${r.label}**${r.description ? `: ${r.description}` : ""}`).join("\n")}\n`;

const md = [
  "# NetworkBase glossary\n\nGenerated from `src/lib/copy/terms.ts` by `scripts/generate-glossary.ts`. The full vocabulary, pronunciations and reasons are in `docs/audits/terminology-roles-workspace-audit-2026-10-28.md` §8–10.\n",
  table("Access levels", Object.entries(terms.ACCESS_LEVEL_LABELS)),
  table("Workspace status", Object.entries(terms.WORKSPACE_STATUS_LABELS)),
  table("Task status", Object.entries(terms.TASK_STATUS_LABELS)),
  table("Sprint status", Object.entries(terms.SPRINT_STATUS_LABELS)),
  table("Notification delivery", Object.entries(terms.DELIVERY_LEVEL_LABELS)),
  table("Conversation types", Object.entries(terms.CONVERSATION_TYPE_LABELS)),
  table("Legal pages", Object.entries(terms.LEGAL_PAGE_NAMES)),
  list("Notification categories", terms.NOTIFICATION_CATEGORIES),
  list("Report reasons", terms.REPORT_REASONS),
  list("Compensation", terms.COMPENSATION_OPTIONS),
  `## Words not to use\n\n| Pattern | Use instead |\n|---|---|\n${terms.BANNED_TERMS.map((t) => `| \`${t.pattern.source.replace(/\|/g, "\\|")}\` | ${t.use} |`).join("\n")}\n`,
].join("\n");
fs.writeFileSync("docs/glossary.md", md);
console.log("docs/glossary.md written");
