import { markdownDestinations } from "@/lib/messaging/markdown-links";
import { sameOriginPath } from "@/lib/messaging/safe-links";
/**
 * Channel canvas helpers and the template gallery. Canvases are stored in
 * chat_canvases (0182); the body is markdown and the title is its own field.
 */

export const CANVAS_MAX_TITLE = 200;
export const CANVAS_MAX_BODY = 100_000;

/** Only actual image destinations on this application's origin retain assets. */
export function canvasAssetId(value: string, origin = "https://networkbase.in"): string | null {
  const path = sameOriginPath(value, origin);
  return path?.match(/^\/api\/v1\/chat\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? null;
}

/** Chat attachment ids referenced by canvas images, deduped and capped at 50. */
export function canvasAssetIds(body: string, origin = "https://networkbase.in") {
  return [...new Set(markdownDestinations(body, "image").flatMap((url) => {
    const id = canvasAssetId(url, origin);
    return id ? [id] : [];
  }))].slice(0, 50);
}

export function canvasAssetUrl(assetId: string) {
  return `/api/v1/chat/attachments/${assetId}`;
}

export type CanvasTemplate = {
  id: string;
  name: string;
  category: "Team" | "Meetings" | "Planning" | "Operations";
  /** When to use it, one line. */
  description: string;
  generate: (channelName: string, projectName?: string | null) => {
    title: string;
    content: string;
  };
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: "channel-overview",
    name: "Channel overview",
    category: "Team",
    description: "What this channel is for, who owns it and where things live.",
    generate: (channelName) => ({
      title: `#${channelName} overview`,
      content: `## Purpose
_One or two sentences: what this channel is for and who should be here._

## What belongs here
- 
## What goes elsewhere
- 
## Owners
- 
## Key links
- 
## How we work
- Questions go in threads so the channel stays readable.
- Use @here only for things that need attention today.`,
    }),
  },
  {
    id: "onboarding",
    name: "Onboarding checklist",
    category: "Team",
    description: "A first-week plan for someone joining the workspace.",
    generate: (_channelName, projectName) => ({
      title: `Welcome to ${projectName || "the team"}`,
      content: `## Start here
_A short welcome and what the first week should achieve._

## First week
- [ ] Get access to the tools you need
- [ ] Read the channel overview and workspace brief
- [ ] Meet the people below
- [ ] Pick up a first small task

## People to meet
- 
## Key documents
- `,
    }),
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    category: "Meetings",
    description: "Agenda, notes, decisions and action items for one meeting.",
    generate: () => ({
      title: `Meeting notes – ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      content: `**Attendees:** 

## Agenda
1. 
## Notes
- 
## Decisions
- 
## Action items
- [ ] Task — owner, due date`,
    }),
  },
  {
    id: "weekly-status",
    name: "Weekly status",
    category: "Meetings",
    description: "Progress, risks and next steps, shared once a week.",
    generate: () => ({
      title: "Weekly status",
      content: `## Highlights
- 
## Progress
- [ ] Goal — status
## Risks and blockers
- 
## Next week
- `,
    }),
  },
  {
    id: "retrospective",
    name: "Retrospective",
    category: "Meetings",
    description: "Look back on a sprint or milestone and agree what to change.",
    generate: () => ({
      title: "Retrospective",
      content: `## What went well
- 
## What didn’t go well
- 
## What we’ll try next
- 
## Action items
- [ ] Change — owner`,
    }),
  },
  {
    id: "project-brief",
    name: "Workspace brief",
    category: "Planning",
    description: "Problem, goals, scope and milestones before work starts.",
    generate: (channelName, projectName) => ({
      title: `${projectName || channelName} brief`,
      content: `## Problem
_Who has the problem, and why it matters now._

## Goals
- 
## How we’ll measure success
- 
## In scope
- 
## Out of scope
- 
## Milestones
- [ ] Milestone — target date
## Open questions
- `,
    }),
  },
  {
    id: "decision-record",
    name: "Decision",
    category: "Planning",
    description: "Write down a decision, the options and why you chose one.",
    generate: () => ({
      title: "Decision: ",
      content: `**Status:** Proposed
**Decided by:** 

## Context
_What needs deciding and why now._

## Options
1. 
2. 
## Decision
_The option chosen and the main reason._

## Consequences
- `,
    }),
  },
  {
    id: "incident-report",
    name: "Incident report",
    category: "Operations",
    description: "What happened, the impact, the cause and the follow-ups.",
    generate: () => ({
      title: "Incident report",
      content: `**Severity:** 
**Status:** Investigating

## Summary
_What happened, in two sentences._

## Impact
- 
## Timeline
- 00:00 — 
## Root cause
_What caused it and why it wasn’t caught._

## Follow-ups
- [ ] Fix — owner`,
    }),
  },
];
