import { z } from "zod";

/**
 * Report 37.5 (plan B8.3a, X4): programs — workspaces under the organization marked Program, each with a brief, an owner,
 * dates or Ongoing, the impact goal it supports and up to 5 measures with targets. A measure counts volunteer hours
 * (X2, confirmed, from shifts tagged to the program), sessions held (finished meetings in the program), or a typed number
 * that an admin confirms before it reaches a report or About; every typed value is kept as history. People served is a
 * typed count: programs never hold records of individual people.
 */
export const PROGRAM_STATES = ["planned", "running", "paused", "closed"] as const;
export type ProgramState = (typeof PROGRAM_STATES)[number];
export const PROGRAM_STATE_WORDS: Record<ProgramState, string> = { planned: "Planned", running: "Running", paused: "Paused", closed: "Closed" };
export const MEASURE_SOURCES = ["hours", "sessions", "typed"] as const;
export const SOURCE_WORDS = { hours: "Volunteer hours", sessions: "Sessions held", typed: "Typed number" } as const;
export const measureSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,30}$/), name: z.string().trim().min(1).max(80), source: z.enum(MEASURE_SOURCES), target: z.number().min(0).max(1e9).nullable() }).strict();
export type Measure = z.infer<typeof measureSchema>;
export const programBriefSchema = z.object({
  change: z.string().trim().max(2000), reality: z.string().trim().max(2000), whyNow: z.string().trim().max(2000), mission: z.string().trim().max(2000), serves: z.string().trim().max(300), howWeKnow: z.string().trim().max(2000),
}).strict();
export const programSchema = z.object({
  title: z.string().trim().min(3).max(100),
  aim: z.string().trim().min(1).max(300),
  place: z.string().trim().max(120),
  start: z.string().date().nullable(),
  end: z.string().date().nullable(),
  goal: z.string().trim().max(80),
  ownerId: z.string().uuid(),
  public: z.boolean(),
  measures: z.array(measureSchema).max(5),
  brief: programBriefSchema,
}).strict().refine((p) => !p.start || !p.end || p.end >= p.start, "A program ends on or after it starts.");
export type ProgramInput = z.infer<typeof programSchema>;
export type ProgramMark = Omit<ProgramInput, "title" | "ownerId"> & { state: ProgramState; closingNote?: string };
export const readProgram = (orgSettings: unknown) => ((orgSettings as { program?: ProgramMark } | null)?.program ?? null);
/** "46 of 50" (measures as text with value and target). */
export const measureLine = (value: number | null, target: number | null) => (value === null ? "not yet confirmed" : target ? `${value} of ${target}` : `${value}`);
/** The brief's starter document (call 2). */
export const briefMarkdown = (title: string, b: z.infer<typeof programBriefSchema>) => `# ${title}: program brief

## What we want to change
${b.change || "_The problem, in people's words._"}

## The desired reality
${b.reality || "_What it looks like when it works._"}

## Why now
${b.whyNow || "_What makes this the moment._"}

## How it fits our mission
${b.mission || "_The line from our mission it serves._"}

## Who it's for
${b.serves || "_In words; never a list of people._"}

## How we'll know
${b.howWeKnow || "_The measures and their targets._"}
`;
