import { typeProfile } from "@/lib/organizations/type-profile";

// Sprint redesign (2026-11-09): the words for an organization's two sprint levels. A class plans Units with Weeks
// inside; everyone else plans Phases with Sprints inside. Settings → Work can rename the main word. Client-safe.

export type SprintWords = {
  /** The main sprint: "Unit", "Phase", or the organization's own word. */
  main: string;
  /** A sprint inside one: "Week" in a class, "Sprint" elsewhere. */
  inner: string;
  /** The left rail's heading: a class plans a term. */
  plan: "Term" | "Plan";
  isClass: boolean;
};

/** Settings → Work offers these; any other short word can be typed. */
export const MAIN_WORD_CHOICES = ["Unit", "Module", "Phase", "Milestone"] as const;

/** A word of letters and spaces, 1–20 long, first letter capital; anything else is no word. */
export function cleanMainWord(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const word = value.trim().replace(/\s+/g, " ");
  if (!/^\p{L}[\p{L} ]{0,19}$/u.test(word)) return null;
  return word[0]!.toUpperCase() + word.slice(1);
}

export function sprintWords(orgType: string | null | undefined, orgSettings?: unknown): SprintWords {
  const profile = typeProfile(orgType);
  const own = cleanMainWord((orgSettings as { mainSprintWord?: unknown } | null | undefined)?.mainSprintWord);
  return { main: own ?? profile.mainSprintWord, inner: profile.innerSprintWord, plan: profile.termDates ? "Term" : "Plan", isClass: profile.termDates };
}

/** "a unit", "an iteration". */
export function aWord(word: string) {
  const lower = word.toLowerCase();
  return `${/^(?:[aeio]|u(?!ni|s[eu]))/.test(lower) ? "an" : "a"} ${lower}`;
}

/** "CO1", "CO 3: Trees", "Sprint 4" → "Unit 1", "Unit 3: Trees", "Unit 4"; null when it isn't an old numbered name. */
export function renamedSprint(name: string, main: string): string | null {
  const match = /^(CO|Sprint|Unit|Module|Phase|Milestone)\s?(\d+)(?=$|[\s:·\-–—])(.*)$/i.exec(name.trim());
  if (!match || match[1]!.toLowerCase() === main.toLowerCase()) return null;
  return `${main} ${match[2]}${match[3]}`;
}
