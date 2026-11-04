# Sprint redesign and focus ring — Implementation Plan

> Native execution on local main, TDD, one local commit per phase, no push. Spec:
> `docs/superpowers/plans/2026-11-04-sprint-redesign-findings.md` (§0 ring, §2–§7 organization, §8 workspace).

**Goal:** one sprint page and one form for organizations and workspaces that say what a sprint is: a stretch of time
with one goal, work planned into it, closed when it ends. No orange focus outline anywhere.

**Architecture:** no migration. Pure rules in `src/lib/workspaces/sprint-plan.ts` (phase, term groups and gaps, time
progress, pace, next start and name, work groups). The server adds people, velocity and a backlog read to the sprint
detail payload, and `addTasksToSprintAction` reuses `updateTaskFieldAction(…, "sprintId")` per task so every existing
rule (who may plan, sprint state, assignment copies follow their main task) still holds.

## Words
Upcoming (planning) · Running (active) · Ended (active, end date passed) · Closed (completed) · Canceled · Archived.
Main action by phase: Upcoming → Add work (+ Start now); Running → Add work (+ Complete early in ⋯); Ended → Close
sprint.

## Phase 1 — focus ring (§0)
`:focus-visible` draws no outline. Keyboard focus keeps the clay tint (links, tabs, rows), the clay border (Buttons),
a darker border on fields, and a thin neutral outline only on native checkboxes and radios.

## Phase 2 — server
- Detail payload: `people` (open points and tasks per assignee, plus unassigned), `velocity` (finished points of the
  last closed sprints: last, average).
- `readSprintBacklogAction({ projectId, query })`: open work with no sprint (tasks; main assignments in an
  organization), newest first, 100 max.
- `addTasksToSprintAction({ projectId, sprintId, taskIds })` (≤ 30): per task through `updateTaskFieldAction`.

## Phase 3 — the page (§5, §8.1–8.5, 8.9)
Rail = term (Now / Next / Later / Past, gaps, Backlog entry, Calendar in its header); header (chip + dates + days
left, name, goal; Edit, ⋯ with Complete early / Cancel / Archive); Time and Work cards with pace; work grouped by
state or person, removed work folded, Mine filter; People (workspace) / Teams (organization) / Files; Ended banner.

## Phase 4 — Add work picker (§8.6)
Backlog with search and ticks; planned points vs last and average; "Add N tasks".

## Phase 5 — New sprint and Close (§6, §8.7, §8.8)
One / Several choice; goal with "Add notes"; length chips; term strip with overlap line; "For the class" summary
with Change; team workspace picks the class sprint first; sentence-case footer naming what it creates. Close dialog:
summary, then where open tasks go (next sprint · backlog · stay here).

## Tests
Unit (sprint-plan rules, source contracts), DB (people, velocity, backlog, add work and its refusals), browser (page
states, picker, form, phone width). Full gate before each commit.
