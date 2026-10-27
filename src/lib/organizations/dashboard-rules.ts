// Org Dashboard, About and Projects rules (report §22, §27, §28), pure so server and screens agree.

const DAY = 86_400_000;

/** Needs attention (report §28.3), with the reasons shown on the row. */
export function needsAttention(input: {
  overdue: number;
  lastActivityAt: Date | null;
  groupCopyState: string | null;
  leadInOrg: boolean;
  status?: string | null;
  now?: Date;
}): string[] {
  if (input.status === "archived") return [];
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  if (input.overdue >= 3) reasons.push(`${input.overdue} overdue`);
  if (!input.lastActivityAt || now.getTime() - input.lastActivityAt.getTime() > 7 * DAY) reasons.push("quiet 7 days");
  if (input.groupCopyState === "missing") reasons.push("group assignment missing");
  if (input.groupCopyState === "returned") reasons.push("group assignment returned");
  if (!input.leadInOrg) reasons.push("lead left the organization");
  return reasons;
}

export type SprintStop = { name: string; status: string; startDate: Date; endDate: Date; completedAt: Date | null };

/**
 * The org Journey is its sprints (report §22.1): done stops carry their completion date, the active sprint is
 * current, otherwise the next planned one; after the last sprint every stop is done.
 */
export function journeyFromSprints(sprints: SprintStop[]) {
  const ordered = [...sprints].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const active = ordered.findIndex((s) => s.status === "active");
  const nextPlanned = ordered.findIndex((s) => s.status !== "completed");
  const currentIndex = active >= 0 ? active : nextPlanned >= 0 ? nextPlanned : ordered.length;
  const completionDates: Record<string, string> = {};
  ordered.forEach((s, i) => {
    if (i < currentIndex && s.completedAt) completionDates[String(i)] = s.completedAt.toISOString();
  });
  return { stages: ordered.map((s) => s.name), currentIndex, completionDates };
}

export type ActivityKind = "sprint" | "project" | "joins" | "announcement" | "doc" | "file" | "assignment" | "submission";

/**
 * Activity privacy (report §27.2): admins see everything; members and guests see org-level events and their
 * own, never other people's submissions or status. About shows only the public-safe kinds (§22.2).
 */
export function activityVisible(event: { kind: ActivityKind; actorId: string | null; public?: boolean }, viewer: { isAdmin: boolean; userId: string | null; publicOnly?: boolean }) {
  if (viewer.publicOnly) return ["sprint", "project", "joins"].includes(event.kind) || (event.kind === "announcement" && event.public === true);
  if (viewer.isAdmin) return true;
  if (event.kind === "submission") return Boolean(viewer.userId) && event.actorId === viewer.userId;
  return true;
}

/** Get started for a new org's admins (report §27.4): each line goes when done; the list goes when all are. */
export function getStartedSteps(state: { members: number; sprints: number; files: number; announcements: number; assignments: number }) {
  return [
    state.members <= 1 ? "Share the join code" : null,
    state.sprints === 0 ? "Plan your sprints" : null,
    state.files === 0 ? "Add materials" : null,
    state.announcements === 0 ? "Post a welcome announcement" : null,
    state.assignments === 0 ? "Create the first assignment" : null,
  ].filter((step): step is string => Boolean(step));
}
