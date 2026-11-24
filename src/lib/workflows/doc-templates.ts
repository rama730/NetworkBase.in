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

| Assumption | Depends on | Evidence | If it’s wrong, what breaks | Cheapest test | Status |
|---|---|---|---|---|---|
| Schools will pay per seat | Teachers want it | Weak | Pricing, revenue plan | 5 calls with heads of IT | Testing |
|  |  |  |  |  | Untested |

_Evidence: None · Weak · Strong. Status: Untested · Testing · Holds · Broken. An assumption others depend on is load-bearing: test it first._
` },
  // 11.8: Value Proposition Canvas: the customer side, our offer, and a fit check.
  { id: "value-proposition", name: "Value proposition", group: "startup", line: "Customer jobs, pains and gains against what you offer.",
    body: `## Customer

### Jobs
_What are they trying to get done?_

### Pains
_What gets in the way, or goes wrong?_

### Gains
_What would make them happy?_

## Our offer

### Products and services

### Pain relievers
_How each pain gets smaller._

### Gain creators
_How each gain happens._

## Fit check

| Pain or gain | What relieves or creates it |
|---|---|
|  | No answer yet |
` },
  // 11.8: Business model canvas by Notion: the nine boxes, each with its group and a prompt (call 3: shown as a grid).
  { id: "business-model-canvas", name: "Business model canvas", group: "startup", line: "The nine boxes: who, what, how and the money.",
    body: `## Key partners
_Infrastructure · Who helps us do this?_

## Key activities
_Infrastructure · What must we do well?_

## Key resources
_Infrastructure · What do we need to have?_

## Value propositions
_Offering · What do we do for them that matters?_

## Customer relationships
_Customers · How do we keep in touch?_

## Channels
_Customers · How do they find and get it?_

## Customer segments
_Customers · Who are we creating value for?_

## Cost structure
_Finances · What does it cost to run?_

## Revenue streams
_Finances · What will they pay for, and how?_
` },
  // 11.8: Investor update by Notion: TL;DR, key numbers, highlights, lowlights, asks, hiring, runway.
  { id: "investor-update", name: "Investor update", group: "startup", line: "A monthly update: numbers, highlights, asks.",
    body: `_The numbers here are as private as this document. Make a new one each month ("Investor update – Nov 2026"); NetworkBase doesn’t send it._

## TL;DR
- 
- 
- 

## Key numbers
_From Goals: the key results you report on, their current value and target._
{% project.goals %}

## Highlights

## Lowlights

## Asks
_What investors can help with. Start next month’s update with these._

## Hiring

## Runway
_Months of cash left._
` },
  // 20.7: Business Plan Builder.
  { id: "business-plan", name: "Business plan", group: "startup", line: "Problem to ask, on one page per part.",
    body: `## Summary

## Problem

## Solution

## Market

## Business model
_Link your Business model canvas here._

## Go to market

## Team

## Financials
${parked("Money")}

## Ask
` },
  // 12.5: Monthly Client Report: health and status, then the report's sections; time comes with Money.
  { id: "client-report", name: "Client report", group: "clients", line: "A monthly report for a client: progress, results, next steps.",
    body: `**Period:** · **Client:** · **Prepared by:**
**Health:** On track · At risk · Blocked — **Status:** Draft · Ready to share · Shared

## Summary
_Three lines: where things stand._

## Progress
{% project.projects %}

## Work completed

## Time
${parked("Money")}

## Results
_Numbers you add, or a key result from Goals._

## Blockers

## Decisions needed
{% project.decisions %}

## Next steps
_What happens next month, with dates._
` },
  // 24.7: Creative brief.
  { id: "creative-brief", name: "Creative brief", group: "clients", line: "What to make, for whom, by when.",
    body: `## Problem

## Audience

## Message

## Deliverables

## Sizes

## Mandatory items
_Logos, legal lines, anything that must appear._

## References

## Deadline
` },
  // 24.7: Brand Identity: Questionnaire (4.9): questions a client answers; answers feed the Brand guide.
  { id: "brand-questionnaire", name: "Brand questionnaire", group: "clients", line: "Questions a client answers before brand work starts.",
    body: `_Answer in your own words; there are no wrong answers. Your answers shape the brand guide._

## About you
**What do you do, in one sentence?**

**Who do you do it for?**

## Personality
**Three words people should feel about your brand:**

**Brands you admire, and why:**

## Look and feel
**Colors you like or must avoid:**

**Styles you like (links or images):**

## Practical
**Where will the brand appear first?**

**Deadline and budget notes:**
` },
  // 24.7: UX/UI Case Study (4.8): problem to result, with images.
  { id: "case-study", name: "Case study", group: "clients", line: "Problem, role, process, decisions, result.",
    body: `## Problem

## My role

## Process

## Decisions
_What you chose, what you didn’t, and why._

## Result

## Images
_Drop images here from Files._
` },
  // 14.7: Brand Style Guide (4.9) with Brand Kit's mission, vision, values.
  { id: "brand-guide", name: "Brand guide", group: "clients", line: "Who you are, how you look, how you sound.",
    body: `## About us
### Purpose
### Positioning
### Personality

## Mission · Vision · Values

## Logos
_Add the logo files from Files._

## Colors
{% project.colors %}

## Typography

## Tone of voice
**We are…**

**We’re not…**

| Do | Don’t |
|---|---|
|  |  |

## Usage rules
_Spacing, minimum size, what never to do._
` },
  // 13.4: Engineering Tech Spec by Notion (5.0 from 26).
  { id: "tech-spec", name: "Tech spec", group: "product", line: "Problem, proposed solution, alternatives, rollout.",
    body: `**Status:** Draft · In review · Approved — **Author:** · **Project:** · **Roadmap item:**

## Problem statement
### Goals
### Non-goals

## Proposed solution
_How it works, the data model, API changes._
### Risks

## Alternatives
_What else we considered, and why not._

## Rollout plan
### Steps
### Success criteria
_How we’ll know it worked._

## Decisions
{% project.decisions %}
` },
  // 13.5: API docs: overview to changes; each endpoint is its own section.
  { id: "api-docs", name: "API docs", group: "product", line: "Authentication, limits, errors and each endpoint.",
    body: `## Overview

## Authentication

## Rate limits

## Errors
| Code | Meaning |
|---|---|
| 401 | Not signed in |
| 404 | Not found |
| 429 | Too many requests |

## Endpoints

### GET /example
_What it does._

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
|  |  |  |  |

**Response**

\`\`\`json
{}
\`\`\`

## Changes
_What changed, newest first._
` },
  // 20.2: PRD.
  { id: "prd", name: "PRD", group: "product", line: "Why, for whom, what’s in, and how we’ll know.",
    body: `**Status:** Draft · In review · Approved — **Product:** · **Prepared by:** · **Version:** v1

## Objective
_Why now, and what problem._

## User personas
_Link the Persona documents._

## Success metrics
_The key results this should move (Goals)._
{% project.goals %}

## Requirements
| Requirement | Priority (Must / Should / Could) | Roadmap item |
|---|---|---|
|  | Must |  |

## User stories
- As a … I want … so that …

## MVP scope
### In
### Out

## Assumptions
_Link the Assumptions check. Technical details go in the Tech spec._

## Dependencies

## Timeline
{% project.projects %}

## Open questions

## Supporting docs
` },
  // 20.3: Product FAQs by Notion: questions grouped by topic.
  { id: "faq", name: "FAQ", group: "product", line: "Questions and answers, grouped by topic.",
    body: `## Getting started

### How do I …?
_The answer, in a few lines._

### What happens when …?

## Accounts and billing

### …?

## Troubleshooting

### …?
` },
  // 20.6: Persona.
  { id: "persona", name: "Persona", group: "product", line: "Who they are, what they want, what gets in the way.",
    body: `## Who they are

## Goals

## Frustrations

## Jobs to be done

## Real quotes
_From user interviews: paste the quote and link the interview._
` },
  // 21.2: Postmortem (blameless), made after an incident is resolved.
  { id: "postmortem", name: "Postmortem", group: "product", line: "What happened, why, and what changes, without blame.",
    body: `_Blameless: describe what happened and what let it happen, not who. People did their best with what they knew._

**Linked bug:** _write NB-n_

## Description

## Timeline
| Time | What happened |
|---|---|
|  |  |

## Root cause

## Resolution

## Actions taken

## Lessons learned

## Recommendations
{% project.task_rows key="actions" label="Follow-up actions" %}
` },
  // 21.5: Test plan: cases with steps, expected result and Result; the pass rate is worked out when shown (call 4).
  { id: "test-plan", name: "Test plan", group: "product", line: "Cases, steps, expected results and a pass rate.",
    body: `_Result is one of Pass · Fail · Blocked · Not run. The pass rate is worked out from the table._

| Case | Steps | Expected | Result | Tester | Date |
|---|---|---|---|---|---|
| Sign in with a school account | Open sign-in, pick SSO, finish | Lands on My work | Not run |  |  |
` },
  // 14.4: Blog post: standfirst, body, sources, and the SEO box.
  { id: "blog-post", name: "Blog post", group: "content", line: "A post with its standfirst, sources and SEO.",
    body: `_Date · Authors · Reading time_

**Standfirst:** _One line: what the reader gets._

## Body
_Headings, images, quotes, code._

## Sources

## SEO
**Title tag:** · **Meta description:** · **Slug:** · **Keyword:**
` },
  // 14.5: Newsletter issue.
  { id: "newsletter", name: "Newsletter", group: "content", line: "An issue: intro, main story, links, sign-off.",
    body: `**Issue #** · **Date:** · **Status:** Draft

## Intro

## Main story

## Links worth your time
- 

## From us

## Sign-off
` },
  // 14.6: Content brief.
  { id: "content-brief", name: "Content brief", group: "content", line: "Goal, audience, keyword, outline, call to action.",
    body: `**Goal:** · **Audience:** · **Keyword:** · **Search intent:**
**Angle:** _what makes this different_
**Target:** words · due — **Writer:**

## Outline
_The H2s in order._

## Key points
_Must-say facts._

## Sources

## Call to action
` },
  // 18.7: Show notes.
  { id: "show-notes", name: "Show notes", group: "content", line: "An episode’s summary, guest, chapters and links.",
    body: `## Summary

## Guest

## Chapters
- 00:00 Intro

## Links mentioned
- 

## Sponsor

## Transcript
_Link the transcript._
` },
  // 18.7: Episode run sheet (Interview Production + Episode Planner).
  { id: "episode-run-sheet", name: "Episode run sheet", group: "content", line: "Segments with times, questions and breaks.",
    body: `## Intro

## Segments
| Time | Segment | Notes |
|---|---|---|
| 00:00 | Intro |  |

## Questions
1. 

## Ad breaks

## Outro
` },
  // 18.7: Sponsor read, shared with the sponsor for approval.
  { id: "sponsor-read", name: "Sponsor read", group: "content", line: "Product, talking points, words to avoid, call to action.",
    body: `## Product

## Talking points
1. 
2. 
3. 

## Words to avoid

## Call to action

## Link
` },
  // 19.7: Video script (YouTube Video Script), with the two-column "said | shown" table.
  { id: "video-script", name: "Video script", group: "content", line: "Hook to outro, with what’s said and what’s shown.",
    body: `## Hook

## Intro

## Main points

| What’s said | What’s shown |
|---|---|
|  | _B-roll, graphics_ |

## Call to action

## Outro
` },
  // 19.7: Beat sheet: the classic story beats, then scenes.
  { id: "beat-sheet", name: "Beat sheet", group: "content", line: "The story’s beats, then the scene list.",
    body: `## Beats
1. **Opening image**
2. **Setup**
3. **Catalyst**
4. **Debate**
5. **Break into two**
6. **Fun and games**
7. **Midpoint**
8. **Bad guys close in**
9. **All is lost**
10. **Dark night of the soul**
11. **Break into three**
12. **Finale**
13. **Final image**

## Scenes
| # | Scene | Beat |
|---|---|---|
| 1 |  |  |
` },
  // 19.7: Short film script (scene headings, action and dialogue as plain blocks; no screenplay formatting).
  { id: "short-film-script", name: "Short film script", group: "content", line: "Scenes with headings, action and dialogue.",
    body: `## INT. PLACE – DAY

_Action: what we see._

**NAME**
Dialogue.

## EXT. PLACE – NIGHT

_Action._
` },
  // 19.4: Call sheet (one page for a shoot day).
  { id: "call-sheet", name: "Call sheet", group: "content", line: "One page for a shoot day: times, place, people, shots.",
    body: `**Date:** · **Call time:** · **Wrap:**

## Location
_Address, parking, nearest hospital._

## Crew
| Role | Name | Call time |
|---|---|---|
|  |  |  |

## Cast
| Role | Name | Call time |
|---|---|---|
|  |  |  |

## Shots to get
- [ ] 

## Weather and notes
` },
  // 15.3: Cornell capture (4.8 from 100+): cues, notes, summary.
  // Report 30.2 W1 (plan B1.1): a class's syllabus, pinned to About as a card; its first paragraph is the card's line.
  { id: "syllabus", name: "Syllabus", group: "learning", line: "What the course covers, how it's marked, and the term's units.",
    body: `What this course covers and who it's for, in two or three sentences.

## Outcomes
- By the end, you can…

## Units
{% project.termplan %}

## How it's marked
| Part | Weight |
|---|---|
| Assignments | |
| Exam | |

## Policies
Late work, AI agents and attendance: see Settings, or ask your teacher.

## Reading
- `,
  },
  { id: "class-notes", name: "Class notes", group: "learning", line: "Cornell notes: cues, notes and a summary.",
    body: `**Lesson:** · **Unit:** · **Week:**

## Cues
### Key points
- 
### Review questions
1. 

## Notes
_Free writing, code, diagrams, images._

## Summary
_Three lines in your own words._
` },
  // 17.7: Grant proposal; outcomes from Goals, budget with Money.
  { id: "grant-proposal", name: "Grant proposal", group: "nonprofit", line: "Need, program, outcomes, budget and evaluation.",
    body: `## Summary

## Need

## Program

## Outcomes
_The key results this grant moves (Goals)._
{% project.goals %}

## Budget
${parked("Money")}

## About us

## Evaluation

## Attachments
- [ ] 
` },
  // 17.7: Impact report (annual); donors named only when they agreed.
  { id: "impact-report", name: "Impact report", group: "nonprofit", line: "A yearly letter, numbers, stories and thanks.",
    body: `## A letter

## Numbers
_The year’s key results (Goals)._
{% project.goals %}

## Stories

## Finances
${parked("Money")}

## Thank you
_Only donors who agreed to be named; anonymous donors are never listed._
` },
  // 22.2: Game design document.
  { id: "game-design-document", name: "Game design document", group: "games", line: "Overview, pillars, features and detail docs.",
    body: `## Overview
**Genre:** · **Target audience:** · **Experience:** · **Platform:** · **Unique selling points:**

## High level
### Brief story
### Main objective
### Gameplay pillars
1. 
2. 
3. 

## Features
| Feature | Roadmap item | Status |
|---|---|---|
|  |  |  |

## Detail docs
_Link the Story, Gameplay and Technical requirements documents._

## Moodboard
${parked("Assets")}
` },
  // 24.4: Character profile (OC Profile, Character Profile for Writers).
  { id: "character-profile", name: "Character profile", group: "games", line: "Who a character is, how they look and who they know.",
    body: `## Portrait
_Add an image from Files._

## Basics
**Name:** · **Age:** · **Role:**

## Appearance

## Personality

## Backstory

## Relationships
| Character | How they’re related |
|---|---|
|  |  |

## Quotes

## Art references
` },
];

export const templateById = (id: string) => DOC_TEMPLATES.find((t) => t.id === id) ?? null;
export const templateTitle = (name: string, title: string) => (title.trim() ? `${name} – ${title.trim()}` : name);
/** W1: "/Docs/Tech spec – Sign-in.md" (slashes and other path characters dropped from the title). */
export const templateFileName = (name: string, title: string) => `${templateTitle(name, title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " "))}.md`;
export const templateBody = (t: DocTemplate, title: string) => `# ${templateTitle(t.name, title)}\n\n${t.body}`;
