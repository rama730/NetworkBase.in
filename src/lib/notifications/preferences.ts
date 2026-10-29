import type {
    NotificationDeliveryPreferences,
    NotificationEntityRefs,
    NotificationImportance,
    NotificationMuteScope,
    NotificationMuteScopeKind,
    NotificationPreferenceCategory,
    NotificationPreferences,
    NotificationQuietHours,
    OrgNotificationChoice,
} from "@/lib/notifications/types";

const DEFAULT_QUIET_HOURS: NotificationQuietHours = {
    enabled: false,
    startMinute: 22 * 60,
    endMinute: 7 * 60,
};

const DEFAULT_DELIVERY: NotificationDeliveryPreferences = {
    browser: false,
    push: false,
    email: true,
};

function normalizeDelivery(value: unknown): NotificationDeliveryPreferences {
    if (!value || typeof value !== "object") return { ...DEFAULT_DELIVERY };
    const candidate = value as Partial<Record<keyof NotificationDeliveryPreferences, unknown>>;
    return {
        browser: typeof candidate.browser === "boolean" ? candidate.browser : DEFAULT_DELIVERY.browser,
        push: typeof candidate.push === "boolean" ? candidate.push : DEFAULT_DELIVERY.push,
        email: typeof candidate.email === "boolean" ? candidate.email : DEFAULT_DELIVERY.email,
    };
}

function clampMinute(value: unknown, fallback: number): number {
    const num = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : Number.NaN;
    if (Number.isNaN(num)) return fallback;
    if (num < 0) return 0;
    if (num > 1439) return 1439;
    return num;
}

function normalizeQuietHours(value: unknown): NotificationQuietHours {
    if (!value || typeof value !== "object") return { ...DEFAULT_QUIET_HOURS };
    const candidate = value as Partial<Record<keyof NotificationQuietHours, unknown>>;
    const timeZone = validTimeZone(candidate.timeZone);
    return {
        enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_QUIET_HOURS.enabled,
        startMinute: clampMinute(candidate.startMinute, DEFAULT_QUIET_HOURS.startMinute),
        endMinute: clampMinute(candidate.endMinute, DEFAULT_QUIET_HOURS.endMinute),
        ...(timeZone ? { timeZone } : {}),
    };
}

/** A real IANA zone name ("America/Los_Angeles"), else null. */
export function validTimeZone(value: unknown): string | null {
    if (typeof value !== "string" || !value || value.length > 64) return null;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return value;
    } catch {
        return null;
    }
}

/** Minutes since midnight at `now`, in `timeZone` (the server's own zone without one). */
function minuteOfDayIn(now: Date, timeZone: string | null | undefined) {
    const zone = validTimeZone(timeZone);
    if (!zone) return now.getHours() * 60 + now.getMinutes();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return pick("hour") * 60 + pick("minute");
}

/** Decision 38: the personal switches use the one category list; a category may cover several stored keys. */
export const NOTIFICATION_PREFERENCE_CATEGORIES = [
    { key: "mentions", keys: ["mentions"], title: "Mentions and replies", description: "When someone mentions you or replies to you." },
    { key: "workflows", keys: ["workflows", "connections"], title: "Invitations and requests", description: "Workspace and mentor invitations, and connection requests." },
    { key: "applications", keys: ["applications"], title: "Applications and roles", description: "New applications and decisions." },
    { key: "tasks", keys: ["tasks"], title: "Tasks", description: "Tasks assigned to you, reviews and due dates." },
    { key: "projects", keys: ["projects"], title: "Updates and announcements", description: "Posts from workspaces and organizations you follow." },
] as const satisfies ReadonlyArray<{ key: NotificationPreferenceCategory; keys: readonly NotificationPreferenceCategory[]; title: string; description: string }>;

const NOTIFICATION_MUTE_SCOPE_KINDS = [
    "notification_type",
    "project",
    "task",
    "person",
    "organization",
] as const satisfies readonly NotificationMuteScopeKind[];

const NOTIFICATION_MUTE_SCOPE_KIND_SET = new Set<NotificationMuteScopeKind>(NOTIFICATION_MUTE_SCOPE_KINDS);

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
    mentions: true,
    workflows: true,
    projects: true,
    tasks: true,
    applications: true,
    connections: true,
    pausedUntil: null,
    mutedScopes: [],
    quietHours: { ...DEFAULT_QUIET_HOURS },
    delivery: { ...DEFAULT_DELIVERY },
    chat: { threadReplies: true, showPreview: true },
    organizations: {},
};

export const DEFAULT_ORG_NOTIFICATION_CHOICE: OrgNotificationChoice = { level: "all", email: true, includeChildren: true };

function normalizeOrganizations(value: unknown): Record<string, OrgNotificationChoice> {
    if (!value || typeof value !== "object") return {};
    const out: Record<string, OrgNotificationChoice> = {};
    for (const [orgId, raw] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
        if (!/^[0-9a-f-]{36}$/i.test(orgId) || !raw || typeof raw !== "object") continue;
        const c = raw as Record<string, unknown>;
        out[orgId] = {
            level: c.level === "important" || c.level === "off" ? c.level : "all",
            email: asBoolean(c.email, true),
            includeChildren: asBoolean(c.includeChildren, true),
        };
    }
    return out;
}

/**
 * Settings › Organizations: All / Important only / Off. A child project's events (refs carry the parent's
 * orgId) follow it when Include child projects is on.
 */
export function orgChoiceBlocks(preferences: NotificationPreferences, refs: NotificationEntityRefs | null | undefined, importance: NotificationImportance | undefined) {
    const choice = refs?.orgId ? preferences.organizations[refs.orgId] : undefined;
    if (!choice) return false;
    const fromChild = Boolean(refs?.projectId && refs.projectId !== refs.orgId);
    if (fromChild && !choice.includeChildren) return false;
    return choice.level === "off" || (choice.level === "important" && importance !== "important");
}

/** This person's choice for an org, or the default (everything, with email). */
export function orgChoiceFor(preferences: NotificationPreferences, orgId: string | null | undefined): OrgNotificationChoice {
    return (orgId && preferences.organizations[orgId]) || DEFAULT_ORG_NOTIFICATION_CHOICE;
}

function normalizeChat(value: unknown) {
    const candidate = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    return {
        threadReplies: asBoolean(candidate.threadReplies, true),
        showPreview: asBoolean(candidate.showPreview, true),
    };
}

function asBoolean(value: unknown, fallback: boolean) {
    return typeof value === "boolean" ? value : fallback;
}

function asIsoDate(value: unknown): string | null {
    if (typeof value !== "string" || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMuteScopeKind(value: unknown): NotificationMuteScopeKind | null {
    if (value === "kind") return "notification_type";
    if (
        typeof value === "string"
        && NOTIFICATION_MUTE_SCOPE_KIND_SET.has(value as NotificationMuteScopeKind)
    ) {
        return value as NotificationMuteScopeKind;
    }
    return null;
}

function normalizeMuteScope(value: unknown): NotificationMuteScope | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<Record<keyof NotificationMuteScope, unknown>>;
    const kind = normalizeMuteScopeKind(candidate.kind);
    const valueKey = typeof candidate.value === "string" ? candidate.value.trim() : "";
    if (!kind || !valueKey) return null;
    return {
        kind,
        value: valueKey,
        label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim().slice(0, 120) : null,
        mutedAt: asIsoDate(candidate.mutedAt),
    };
}

function normalizeMuteScopes(value: unknown): NotificationMuteScope[] {
    if (!Array.isArray(value)) return [];
    const unique = new Map<string, NotificationMuteScope>();
    for (const raw of value) {
        const scope = normalizeMuteScope(raw);
        if (!scope) continue;
        unique.set(`${scope.kind}:${scope.value}`, scope);
    }
    return Array.from(unique.values()).slice(0, 100);
}

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_NOTIFICATION_PREFERENCES, chat: { ...DEFAULT_NOTIFICATION_PREFERENCES.chat }, organizations: {} };
    }

    const candidate = value as Partial<Record<keyof NotificationPreferences, unknown>>;
    return {
        mentions: asBoolean(candidate.mentions, DEFAULT_NOTIFICATION_PREFERENCES.mentions),
        workflows: asBoolean(candidate.workflows, DEFAULT_NOTIFICATION_PREFERENCES.workflows),
        projects: asBoolean(candidate.projects, DEFAULT_NOTIFICATION_PREFERENCES.projects),
        tasks: asBoolean(candidate.tasks, DEFAULT_NOTIFICATION_PREFERENCES.tasks),
        applications: asBoolean(candidate.applications, DEFAULT_NOTIFICATION_PREFERENCES.applications),
        connections: asBoolean(candidate.connections, DEFAULT_NOTIFICATION_PREFERENCES.connections),
        pausedUntil: asIsoDate(candidate.pausedUntil),
        mutedScopes: normalizeMuteScopes(candidate.mutedScopes),
        quietHours: normalizeQuietHours(candidate.quietHours),
        delivery: normalizeDelivery(candidate.delivery),
        chat: normalizeChat(candidate.chat),
        organizations: normalizeOrganizations(candidate.organizations),
    };
}

export function isNotificationPauseActive(preferences: NotificationPreferences, now: Date = new Date()) {
    if (!preferences.pausedUntil) return false;
    const pausedUntil = new Date(preferences.pausedUntil);
    return !Number.isNaN(pausedUntil.getTime()) && pausedUntil.getTime() > now.getTime();
}

export function getNotificationPauseUntil(preferences: NotificationPreferences, now: Date = new Date()): Date | null {
    if (!isNotificationPauseActive(preferences, now) || !preferences.pausedUntil) return null;
    const pausedUntil = new Date(preferences.pausedUntil);
    return Number.isNaN(pausedUntil.getTime()) ? null : pausedUntil;
}

/**
 * Quiet hours are the user's own clock: their saved zone, else `fallbackZone` (where their
 * browser last was), else server time. 22:00–07:00 in California is night there, not here.
 */
export function isQuietHoursActive(preferences: NotificationPreferences, now: Date = new Date(), fallbackZone?: string | null) {
    const { enabled, startMinute, endMinute } = preferences.quietHours;
    if (!enabled) return false;
    if (startMinute === endMinute) return false;
    const minuteOfDay = minuteOfDayIn(now, preferences.quietHours.timeZone ?? fallbackZone);
    if (startMinute < endMinute) {
        return minuteOfDay >= startMinute && minuteOfDay < endMinute;
    }
    return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

export function getQuietHoursResumeAt(preferences: NotificationPreferences, now: Date = new Date(), fallbackZone?: string | null): Date | null {
    if (!isQuietHoursActive(preferences, now, fallbackZone)) return null;
    // The minutes from now (on the user's clock) until the end, added to now: right in any zone.
    // ponytail: a DST change inside quiet hours shifts the resume by an hour. upgrade: zoned date math.
    const minuteOfDay = minuteOfDayIn(now, preferences.quietHours.timeZone ?? fallbackZone);
    const minutes = (preferences.quietHours.endMinute - minuteOfDay + 1440) % 1440 || 1440;
    const resume = new Date(now.getTime() + minutes * 60_000);
    resume.setSeconds(0, 0);
    return resume;
}

export function formatMinuteOfDay(minute: number): string {
    const safe = Math.min(1439, Math.max(0, Math.floor(minute)));
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function parseTimeInput(value: string): number | null {
    const match = value.trim().match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}
