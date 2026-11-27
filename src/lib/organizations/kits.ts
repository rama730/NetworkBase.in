/**
 * Report 37.2 (plan B8.4, X1): an Other organization starts from a kit — fixed data, built only from workflows that
 * exist. A kit sets defaults (role names, join mode, time word, starter documents, Getting started) and switches parts
 * on; everything stays editable. Settings → Workflows adds parts from any kit later and turns them off without deleting
 * data. A kit is offered only once every one of its parts works in an Other organization (the contract test checks it).
 * The typed label suggests a kit from a fixed word list in the browser; nothing is sent anywhere.
 */
export type PartId = "volunteers" | "fixedTime" | "programs" | "events" | "boardMeetings" | "meetings" | "renewal" | "positions" | "clubMeetings"
  | "handbook" | "directory" | "goals" | "requests" | "frontDoor" | "members" | "groups";
export type Part = { id: PartId; name: string; line: string; where: string; ready: boolean };
/** Every part a kit can switch on, and whether it works in an Other organization yet (B8.5–B8.10 open the rest). */
export const PARTS: Record<PartId, Part> = {
  volunteers: { id: "volunteers", name: "Volunteers and shifts", line: "Roles, shifts, check-in and hours (X2).", where: "Overview", ready: true },
  fixedTime: { id: "fixedTime", name: "Key date and wrap-up", line: "A countdown, a plan worked back from the key date, bookings and wrap-up (X3).", where: "Overview", ready: true },
  programs: { id: "programs", name: "Programs and impact", line: "Programs with measures, confirmed numbers, stories and the impact report (X4).", where: "Overview", ready: true },
  events: { id: "events", name: "Events", line: "Events with RSVPs, a waitlist and check-in (M3).", where: "Sprints", ready: true },
  boardMeetings: { id: "boardMeetings", name: "Board meetings", line: "Motions, votes, quorum and approved minutes (17.5).", where: "Overview", ready: true },
  meetings: { id: "meetings", name: "Meetings", line: "Meetings with agendas, notes and action items (11.6).", where: "Overview", ready: true },
  renewal: { id: "renewal", name: "Members and renewal", line: "Who's staying each year (L1).", where: "Overview", ready: true },
  positions: { id: "positions", name: "Committee and handover", line: "Positions, elections and the yearly handover (L2).", where: "Overview", ready: true },
  clubMeetings: { id: "clubMeetings", name: "Meetings and minutes", line: "General meetings, minutes, motions and the constitution (L3).", where: "Overview", ready: true },
  handbook: { id: "handbook", name: "Handbook", line: "Handbook pages and processes (K1).", where: "Documents", ready: true },
  directory: { id: "directory", name: "Directory", line: "Who does what, and who to ask (K2).", where: "Members", ready: true },
  goals: { id: "goals", name: "Goals and projects", line: "Goals for the period and the projects behind them (K3).", where: "Overview", ready: true },
  requests: { id: "requests", name: "Requests", line: "Requests to teams with an owner and a due date (K5).", where: "Tasks", ready: true },
  frontDoor: { id: "frontDoor", name: "Welcome", line: "The front door: agreement, welcome and first steps (M1).", where: "About", ready: true },
  members: { id: "members", name: "Members", line: "A member directory with statuses (M2).", where: "Members", ready: true },
  groups: { id: "groups", name: "Small groups", line: "Groups people join or ask to join (M5).", where: "Projects", ready: true },
};

export type KitId = "nonprofit" | "event_team" | "association" | "public_sector" | "faith" | "blank";
export type Kit = { id: KitId; name: string; roles: { owner: string; admin: string; member: string; viewer: string }; join: "approval" | "instant"; timeWord: string;
  lines: [string, string, string]; parts: PartId[]; starters: string[]; gettingStarted: string[]; needsEndDate?: boolean };
export const KITS: Kit[] = [
  { id: "nonprofit", name: "Nonprofit", roles: { owner: "Director", admin: "Coordinator", member: "Volunteer", viewer: "Viewer" }, join: "approval", timeWord: "Year",
    lines: ["Programs and their impact", "Volunteers and shifts", "Board meetings and events"], parts: ["volunteers", "programs", "boardMeetings", "events"],
    starters: ["mission-and-values"], gettingStarted: ["Write your mission", "Add volunteer roles", "Start a program"] },
  { id: "event_team", name: "Event team", roles: { owner: "Organiser", admin: "Coordinator", member: "Team member", viewer: "Viewer" }, join: "approval", timeWord: "Phase",
    lines: ["Ends on a date, planned backwards", "Volunteers and shifts", "The event, meetings and run of show"], parts: ["fixedTime", "volunteers", "events", "meetings"],
    starters: [], gettingStarted: ["Set the event date", "Pick a plan", "Add volunteer roles"], needsEndDate: true },
  { id: "association", name: "Association or committee", roles: { owner: "Chair", admin: "Officer", member: "Member", viewer: "Viewer" }, join: "approval", timeWord: "Year",
    lines: ["Members and yearly renewal", "Committee and the yearly handover", "Meetings, minutes and the constitution"], parts: ["renewal", "positions", "clubMeetings", "events"],
    starters: [], gettingStarted: ["Set up positions", "Write the constitution", "Plan a general meeting"] },
  { id: "public_sector", name: "Public-sector team", roles: { owner: "Owner", admin: "Manager", member: "Member", viewer: "Viewer" }, join: "approval", timeWord: "Quarter",
    lines: ["Handbook and directory", "Goals and projects", "Requests between teams"], parts: ["handbook", "directory", "goals", "requests"],
    starters: [], gettingStarted: ["Write the first handbook page", "Set this quarter's goals"] },
  { id: "faith", name: "Faith or interest community", roles: { owner: "Owner", admin: "Organiser", member: "Member", viewer: "Viewer" }, join: "instant", timeWord: "Season",
    lines: ["A welcome and first steps", "Members and small groups", "Events"], parts: ["frontDoor", "members", "events", "groups"],
    starters: [], gettingStarted: ["Write the welcome", "Start a small group", "Add the first event"] },
  { id: "blank", name: "Blank", roles: { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" }, join: "approval", timeWord: "Sprint",
    lines: ["Nothing switched on", "Add parts later in Settings", "Everything can be changed later"], parts: [], starters: [], gettingStarted: [] },
];
export const kitById = (id: string | null | undefined) => KITS.find((k) => k.id === id) ?? null;
/** A kit is offered once all its parts work in an Other organization. */
export const kitReady = (k: Kit) => k.parts.every((p) => PARTS[p].ready);
export const readyKits = () => KITS.filter(kitReady);

/** The fixed word list (call 3): the typed label suggests a kit; matched in the browser, no AI, nothing sent. */
const WORDS: Array<[KitId, string[]]> = [
  ["nonprofit", ["nonprofit", "non-profit", "ngo", "charity", "foundation", "trust", "food bank"]],
  ["event_team", ["event", "hackathon", "festival", "fest", "conference", "summit", "meetup", "fair", "expo", "jam"]],
  ["association", ["committee", "association", "society", "pta", "hostel", "residents", "alumni", "union", "council of students"]],
  ["public_sector", ["government", "council", "department", "ministry", "municipal", "public", "agency"]],
  ["faith", ["church", "temple", "mosque", "gurdwara", "synagogue", "faith", "fellowship", "parish", "hobby", "interest"]],
];
export function suggestKit(label: string): KitId | null {
  const l = ` ${label.toLowerCase()} `;
  for (const [kit, words] of WORDS) if (words.some((w) => l.includes(w))) return kit;
  return null;
}

/** The parts on in an organization (org_settings.parts.on); turning a part off keeps its data. */
export function partsOn(orgSettings: unknown): PartId[] {
  const on = (orgSettings as { parts?: { on?: unknown } } | null)?.parts?.on;
  return Array.isArray(on) ? on.filter((p): p is PartId => typeof p === "string" && p in PARTS) : [];
}
export const partOn = (orgSettings: unknown, p: PartId) => partsOn(orgSettings).includes(p);

/** What a kit saves on a new Other organization: its id (for help text) and its parts, switched on. Only ready kits. */
export function kitSettings(id: string | null | undefined, keyDate?: string | null) {
  const k = kitById(id);
  if (!k || !kitReady(k) || k.id === "blank") return {};
  // The Event team kit's key date (X3): the event day, with the end 30 days after.
  const fixed = k.needsEndDate && keyDate && /^\d{4}-\d{2}-\d{2}$/.test(keyDate)
    ? { fixedTime: { keyDate, endDate: new Date(Date.parse(`${keyDate}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10) } } : {};
  return { kit: k.id, parts: { on: k.parts }, ...fixed };
}

/** B8.7: a club's part (L1–L3) in a club, or in an Other organization that switched it on (the Association kit). */
export const clubLike = (type: string | null | undefined, orgSettings: unknown, part: "renewal" | "positions" | "clubMeetings") =>
  type === "club" || (type === "other" && partOn(orgSettings, part));

/** B8.8: a company's part (K1–K5) in a company, or in an Other organization that switched it on (the Public-sector kit). */
export const companyLike = (type: string | null | undefined, orgSettings: unknown, part: "handbook" | "directory" | "goals" | "requests") =>
  type === "company" || (type === "other" && partOn(orgSettings, part));

/** B8.9: a community's part (M1, M2, M5) in a community, or in an Other organization that switched it on (the Faith kit). */
export const communityLike = (type: string | null | undefined, orgSettings: unknown, part: "frontDoor" | "members" | "groups") =>
  type === "community" || (type === "other" && partOn(orgSettings, part));
