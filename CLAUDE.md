# Project Instructions

## Skill workflow

One skill per job. Invoke the skill via the Skill tool when the request matches its step.

| Step | Skill | Use |
|---|---|---|
| Cut | `ponytail-audit`, `ponytail-debt` | Start each phase by listing what to delete; ledger any shortcut with its ceiling and upgrade trigger. |
| Plan | `superpowers:writing-plans` | One short plan per phase. Brainstorm only for new features. |
| Scope guard | `freeze` | Lock edits to the phase's folder. |
| Build | `ponytail`, `superpowers:test-driven-development` | Smallest change; test first on SQL and query changes. |
| Debug | `investigate` | Only when a check fails. |
| Measure | `benchmark` | Before and after numbers for every phase. |
| Review | `ponytail-review`, then `review` | Cut complexity first, then check correctness. |
| Ship | `ship`, then `canary` | PR, deploy, watch production. |
| Talk | `caveman` (lite), `caveman-commit` | Short status, short commits. |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
