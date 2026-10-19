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

export function personConnectedDate(value?: string | Date | null, requestedAt?: string | Date | null) {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) {
        const requestDate = requestedAt ? new Date(requestedAt) : null;
        if (requestDate && Number.isFinite(requestDate.getTime())) {
            const month = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(requestDate);
            return {
                text: `Request sent · ${month}`,
                compactText: `Requested · ${month}`,
                title: `Connection request sent on ${requestDate.toUTCString()}; acceptance date unavailable`,
            };
        }
        return { text: 'Connected', compactText: 'Connected', title: 'Connected; acceptance date unavailable' };
    }
    const month = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
    return {
        text: `Connected · ${month}`,
        compactText: `Since ${month}`,
        title: `Connected on ${date.toUTCString()}`,
    };
}

export function personRequestDate(value?: string | Date | null) {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return null;
    const text = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(date);
    return { text: `Requested · ${text}`, compactText: text, title: date.toUTCString() };
}

export function personSharedCount(value?: number | null) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function personCompactCount(value: number) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
