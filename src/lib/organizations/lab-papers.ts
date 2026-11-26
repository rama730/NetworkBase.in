import { z } from "zod";

// Report 35.3 (plan B6.3a, R2): papers and publications in a research lab. One flow for six kinds; ordered authors
// (members by account, outsiders as typed names, never contacted); every member author confirms the list before
// Submitted; Rejected is recorded and returns to Drafting. Pure and client-safe.

export const PAPER_KINDS = { paper: "Paper", preprint: "Preprint", talk: "Talk", poster: "Poster", dataset: "Dataset", software: "Software" } as const;
export type PaperKind = keyof typeof PAPER_KINDS;
export const PAPER_STAGE_WORDS = { idea: "Idea", drafting: "Drafting", internal_review: "Internal review", submitted: "Submitted", revising: "Revising",
  accepted: "Accepted", published: "Published", withdrawn: "Withdrawn" } as const;
export type PaperStage = keyof typeof PAPER_STAGE_WORDS;

export const authorSchema = z.union([
  z.object({ userId: z.string().uuid() }).strict(),
  z.object({ name: z.string().trim().min(1).max(120) }).strict(),
]);
export type PaperAuthor = z.infer<typeof authorSchema>;

export const paperSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(["paper", "preprint", "talk", "poster", "dataset", "software"]),
  /** Typed, never fetched (call 7). */
  venue: z.string().trim().max(200),
  deadline: z.string().date().nullable(),
  link: z.string().trim().max(500).refine((u) => !u || /^https?:\/\//i.test(u), "http or https only"),
  doi: z.string().trim().max(200),
  authors: z.array(authorSchema).min(1).max(50),
  /** Call 10: seen only by its authors and the PI. */
  private: z.boolean(),
  /** Call 8: a preprint the authors mark goes public before it's Published. */
  preprintPublic: z.boolean(),
}).strict();
export type PaperInput = z.infer<typeof paperSchema>;

export type PaperHistory = { stage: PaperStage | "rejected"; at: string; by: string | null; venue?: string; note?: string };
export type PaperFields = Omit<PaperInput, "title"> & {
  /** userId → the author-list key they confirmed; changing the list asks again. */
  confirmed: Record<string, string>;
  history: PaperHistory[];
  review?: { approvedBy: string; at: string; listKey: string; kind?: PaperKind } | null;
};

/** A key for the author list as it stands: confirmations hold only for this exact order. */
export const authorListKey = (authors: PaperAuthor[]) => JSON.stringify(authors.map((a) => ("userId" in a ? ["u", a.userId] : ["n", a.name.trim().toLowerCase()])));
export const memberAuthors = (authors: PaperAuthor[]) => [...new Set(authors.flatMap((a) => ("userId" in a ? [a.userId] : [])))];

/** Call 5: every member author confirmed this list. */
export function allConfirmed(f: Pick<PaperFields, "authors" | "confirmed">) {
  const key = authorListKey(f.authors);
  return memberAuthors(f.authors).every((id) => f.confirmed[id] === key);
}

/** Where a paper may go next (call 3). "rejected" is recorded and lands in Drafting. */
export const NEXT: Record<PaperStage, Array<PaperStage | "rejected">> = {
  idea: ["drafting", "withdrawn"],
  drafting: ["internal_review", "submitted", "withdrawn"],
  internal_review: ["drafting", "submitted", "withdrawn"],
  submitted: ["revising", "accepted", "rejected", "withdrawn"],
  revising: ["submitted", "withdrawn"],
  accepted: ["published", "withdrawn"],
  published: [],
  withdrawn: ["drafting"],
};

/** Why a move is refused, or null. `reviewOn`: the lab's internal review before submitting (call 6, on by default). */
export function moveProblem(f: PaperFields, from: PaperStage, to: PaperStage | "rejected", reviewOn: boolean): string | null {
  if (!NEXT[from]?.includes(to)) return `A paper can’t go from ${PAPER_STAGE_WORDS[from]} to ${to === "rejected" ? "Rejected" : PAPER_STAGE_WORDS[to]}.`;
  if (to === "submitted") {
    // Review: every move into Submitted, a resubmission too, needs the current list confirmed.
    if (!allConfirmed(f)) return "Every member author confirms the author list before it’s submitted.";
    // The PI's approval holds for this list and this kind; a resubmission from Revising doesn't need it again.
    if (from !== "revising" && reviewOn && f.kind === "paper" && !(f.review && f.review.listKey === authorListKey(f.authors) && (f.review.kind ?? "paper") === f.kind)) {
      return "It goes through internal review before it’s submitted.";
    }
  }
  return null;
}

/** About (call 8): only Published work, or a preprint its authors marked, and never a private one. */
export const isPublicPaper = (stage: string, f: Pick<PaperFields, "kind" | "private" | "preprintPublic">) =>
  !f.private && (stage === "published" || (f.kind === "preprint" && f.preprintPublic && stage !== "withdrawn"));
/** From Submitted on, the author list and kind are what was sent (review): changes go through Withdrawn or Revising. */
export const LOCKED_STAGES: PaperStage[] = ["submitted", "accepted", "published"];

/** "Dr. Rao, Mei and A. Outsider" with members by name. */
export function authorLine(authors: PaperAuthor[], names: Map<string, string>) {
  const list = authors.map((a) => ("userId" in a ? names.get(a.userId) ?? "Someone" : a.name));
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}
