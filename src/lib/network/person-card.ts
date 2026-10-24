import { canonicalizeSkillLabels } from '@/lib/skills/matching';

export type PersonPortfolio = {
    total: number;
    projects: Array<{ id: string; title: string; slug: string | null }>;
    hasExternal?: boolean;
};

export type PersonCardDetails = {
    location?: string | null;
    headline?: string | null;
    openToCollaborate?: boolean | null;
    mutualConnections?: number | null;
    portfolio?: PersonPortfolio | null;
    skills?: string[];
    isLockedProfile?: boolean;
    isUnavailable?: boolean;
    openTo?: string[] | null;
    openToCustomRoles?: string[] | null;
    preferredCategories?: string[] | null;
    experienceLevel?: string | null;
    hoursPerWeek?: string | null;
};

export type PersonCardIdentity = PersonCardDetails & {
    id?: string | null;
    username?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
    headline?: string | null;
    location?: string | null;
    lastActiveAt?: string | null;
};

export function personCardName(person: PersonCardIdentity) {
    return person.fullName?.trim() || person.username?.trim() || 'NetworkBase member';
}

export function personCardSkills(labels: readonly string[] = []) {
    return canonicalizeSkillLabels(labels, labels.length);
}

export function personPortfolioText(portfolio?: PersonPortfolio | null) {
    if (!portfolio) return null;
    if (portfolio.hasExternal) return 'Public portfolio';
    if (!Number.isSafeInteger(portfolio.total) || portfolio.total <= 0) return null;
    const title = portfolio.total === 1 ? portfolio.projects[0]?.title.trim() : null;
    return title ? `Public portfolio · ${title}` : `${portfolio.total} public ${portfolio.total === 1 ? 'project' : 'projects'}`;
}

export function personCardSubtitle(person: PersonCardIdentity) {
    if (person.isLockedProfile) return { kind: 'private' as const, text: 'Private profile' };
    const headline = person.headline?.trim();
    if (headline) return { kind: 'headline' as const, text: headline };
    const portfolio = personPortfolioText(person.portfolio);
    if (portfolio) return { kind: 'portfolio' as const, text: portfolio };
    const location = person.location?.trim();
    if (location) return { kind: 'location' as const, text: location };
    return { kind: 'username' as const, text: person.username?.trim() ? `@${person.username.trim()}` : '' };
}

export function personConnectedDate(value?: string | Date | null) {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) {
        // A request timestamp cannot establish when the connection was accepted.
        return { text: 'Connected', compactText: 'Connected', title: 'Connected; acceptance date unavailable' };
    }
    const month = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
    return {
        text: `Connected since ${month}`,
        compactText: `Since ${month}`,
        title: `Connected on ${date.toUTCString()}`,
    };
}

const requestAgeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
const requestAgeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 86_400_000], ['month', 30 * 86_400_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000],
];

export function personRequestDate(value?: string | Date | null, nowMs = Date.now(), label = 'Requested') {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime()) || !Number.isFinite(nowMs)) return null;
    const elapsed = nowMs - date.getTime();
    const absolute = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
    const unit = requestAgeUnits.find(([, duration]) => elapsed >= duration);
    // Show a real future date rather than a negative or invented waiting duration.
    const text = elapsed < -60_000 ? absolute : unit
        ? requestAgeFormatter.format(-Math.floor(elapsed / unit[1]), unit[0])
        : 'Just now';
    return { text: `${label} · ${text}`, compactText: text, title: date.toUTCString() };
}

export function personSharedCount(value?: number | null) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function personCompactCount(value: number) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
