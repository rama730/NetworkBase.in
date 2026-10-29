type SprintPersonName = {
  fullName: string | null;
} | null | undefined;

/**
 * Attribution never guesses why a profile is missing. The lifecycle event
 * snapshot is preferred by the reader; this is the final presentation guard.
 */
export function sprintTimelinePersonName(
  person: SprintPersonName,
  fallback = "A workspace member",
) {
  return person?.fullName?.trim() || fallback;
}

