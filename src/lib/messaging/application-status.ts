/** How an application's status reads in the conversation list, the header bar and the card. */
export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  accepted: "Accepted",
  rejected: "Declined",
  withdrawn: "Withdrawn",
  proposed: "Invited",
};

/** The shared status chip's tone for each (status colours mean status). */
export const APPLICATION_STATUS_TONE: Record<string, string> = {
  pending: "draft",
  accepted: "completed",
  rejected: "blocked",
  withdrawn: "archived",
  proposed: "draft",
};

export type ApplicationLineKind = "accepted" | "declined" | "withdrew" | "reopened" | "applied" | "edited" | "closed";

/** Older lines were written before the verbs were settled; read them as the verbs we use now. */
const LEGACY_LINES: Array<[RegExp, string]> = [
  [/^application reopened for review\.?/i, "reopened this application"],
  [/^application withdrawn by applicant\.?/i, "withdrew this application"],
  [/^reapplied\.?$/i, "applied again"],
];

export function normalizeApplicationLine(body: string) {
  const legacy = LEGACY_LINES.find(([pattern]) => pattern.test(body));
  return legacy ? body.replace(legacy[0], legacy[1]) : body;
}

/** Which kind of status line this is, for its icon; null for every other system line. */
export function applicationLineKind(body: string): ApplicationLineKind | null {
  const line = normalizeApplicationLine(body).toLowerCase();
  if (line.startsWith("accepted this application")) return "accepted";
  if (line.startsWith("declined this application")) return "declined";
  if (line.startsWith("withdrew this application")) return "withdrew";
  if (line.startsWith("reopened this application")) return "reopened";
  if (line.startsWith("applied again")) return "applied";
  if (line.startsWith("edited the application")) return "edited";
  if (line.startsWith("closed this application") || line.startsWith("joined the project")) return "closed";
  return null;
}

/** A thread is "decided" once the application is no longer waiting for a reviewer. */
export const isDecidedApplication = (status: string | undefined | null) => Boolean(status) && status !== "pending";
