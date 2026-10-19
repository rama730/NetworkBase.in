/** How an application's status reads in the conversation list, the header bar and the card. */
export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  accepted: "Accepted",
  rejected: "Declined",
  withdrawn: "Withdrawn",
};

/** The shared status chip's tone for each (status colours mean status). */
export const APPLICATION_STATUS_TONE: Record<string, string> = {
  pending: "draft",
  accepted: "completed",
  rejected: "blocked",
  withdrawn: "archived",
};

/** A thread is "decided" once the application is no longer waiting for a reviewer. */
export const isDecidedApplication = (status: string | undefined | null) => Boolean(status) && status !== "pending";
