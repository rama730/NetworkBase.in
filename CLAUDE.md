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
