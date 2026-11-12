import { profileEditHref } from '@/lib/profile/edit-route'
import { experienceLevelLabel, weeklyCapacityLabel } from '@/lib/profile/role-preferences'

export type ProfileDetailsRow = {
    key: 'experience' | 'availability' | 'interests' | 'localTime' | 'joined'
    label: string
    /** null only on an owner's empty row, which shows addHref instead. */
    value: string | string[] | null
    /** Full wording for hover and screen readers, e.g. the time-zone name beside a local time. */
    description?: string
    addLabel?: string
    addHref?: string
}

const monthYear = (value: unknown, month: 'long' | 'short') => {
    const date = value ? new Date(value as string) : null
    if (!date || !Number.isFinite(date.getTime())) return null
    return new Intl.DateTimeFormat('en', { month, year: 'numeric', timeZone: 'UTC' }).format(date)
}

function clock(now: Date, timeZone?: string | null) {
    try {
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timeZone ?? undefined }).format(now)
    } catch {
        return null // An unknown zone name throws: no row rather than a broken card.
    }
}

/**
 * The Details card: the facts the profile header doesn't already show. Each row appears only with a value,
 * and Joined is always there, so a profile anyone can open never ends in blank space.
 */
export function profileDetailsRows(input: {
    isOwner: boolean
    /** Collaboration preferences is on the page and already lists experience and availability. */
    preferencesShownElsewhere: boolean
    experienceLevel?: unknown
    hoursPerWeek?: unknown
    interests?: unknown
    timeZone?: string | null
    createdAt?: unknown
    now: Date
    viewerTimeZone?: string
}): ProfileDetailsRow[] {
    const rows: ProfileDetailsRow[] = []
    if (!input.preferencesShownElsewhere) {
        const experience = experienceLevelLabel(input.experienceLevel)
        if (experience) rows.push({ key: 'experience', label: 'Experience', value: experience })
        const availability = weeklyCapacityLabel(input.hoursPerWeek)
        if (availability) rows.push({ key: 'availability', label: 'Availability', value: availability })
    }

    const interests = Array.isArray(input.interests)
        ? input.interests.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
    if (interests.length) rows.push({ key: 'interests', label: 'Interests', value: interests })
    else if (input.isOwner) rows.push({ key: 'interests', label: 'Interests', value: null, addLabel: 'Add interests', addHref: profileEditHref('skills') })

    if (!input.isOwner && input.timeZone) {
        const theirs = clock(input.now, input.timeZone)
        if (theirs && theirs !== clock(input.now, input.viewerTimeZone)) rows.push({ key: 'localTime', label: 'Local time', value: theirs, description: `${theirs}, ${input.timeZone}` })
    }

    const joined = monthYear(input.createdAt, 'long')
    if (joined) rows.push({ key: 'joined', label: 'Joined', value: joined })
    return rows
}

/** A visitor's header line for a brand-new account, instead of "0 connections · 0 workspaces". */
export function profileNewMemberLine(input: { isOwner: boolean; connectionsCount: number; workspacesCount: number; createdAt?: unknown }) {
    if (input.isOwner || input.connectionsCount > 0 || input.workspacesCount > 0) return null
    const joined = monthYear(input.createdAt, 'short')
    return joined ? `New member · joined ${joined}` : 'New member'
}
