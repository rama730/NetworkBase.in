import { useSyncExternalStore } from 'react'
import { normalizeSkillLookup, skillMonogram, skillSlug } from './normalization'
import type { SkillSummary } from './types'

type ClientSkillTuple = readonly [string, string, string, string, string | null, string, string]

export type SkillCatalog = {
    version: string
    categories: ReadonlyArray<{ key: string; name: string; iconKey: string }>
    lookup: Readonly<Record<string, ClientSkillTuple>>
    defaults: ReadonlyArray<string>
}

let catalog: SkillCatalog | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function setSkillCatalog(next: SkillCatalog) {
    catalog = next
    listeners.forEach((listener) => listener())
}

function loadSkillCatalog() {
    if (catalog || loading || typeof window === 'undefined') return
    loading = fetch('/skill-catalog.json')
        .then((response) => (response.ok ? response.json() : null))
        .then((next: SkillCatalog | null) => {
            if (next) setSkillCatalog(next)
        })
        .catch(() => undefined)
        .finally(() => {
            loading = null
        })
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    loadSkillCatalog()
    return () => {
        listeners.delete(listener)
    }
}

export function useSkillCatalog(): SkillCatalog | null {
    return useSyncExternalStore(subscribe, () => catalog, () => null)
}

export function resolveClientSkill(value: string): SkillSummary {
    const tuple = catalog?.lookup[normalizeSkillLookup(value)]
    if (tuple) {
        return {
            canonicalKey: tuple[0],
            name: tuple[1],
            slug: skillSlug(tuple[1]),
            iconSource: tuple[2] as SkillSummary['iconSource'],
            iconKey: tuple[3],
            brandColor: tuple[4],
            categoryKey: tuple[5],
            kind: tuple[6] as SkillSummary['kind'],
            marketTier: 'core',
            status: 'active',
            replacementSkillId: null,
        }
    }

    const display = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    return {
        canonicalKey: `custom.${skillSlug(display) || skillMonogram(display).toLocaleLowerCase('en-US')}`,
        name: display,
        slug: skillSlug(display),
        iconSource: 'monogram',
        iconKey: 'badge',
        brandColor: null,
        categoryKey: 'human',
        kind: 'competency',
        marketTier: 'extended',
        status: 'pending',
        replacementSkillId: null,
    }
}

export function defaultClientSkills(): SkillSummary[] {
    return (catalog?.defaults ?? []).map((key) => resolveClientSkill(key))
}
