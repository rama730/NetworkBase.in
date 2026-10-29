import { searchPeople } from '@/app/actions/chat/members'

export type FoundPerson = { id: string; name: string; username: string | null }

/** People search for the create wizard's co-admins, reshaped at the edge into the app's camelCase identity. */
export async function findPeople(query: string): Promise<FoundPerson[]> {
    const result = await searchPeople({ query })
    return result.success ? result.people.map((p) => ({ id: p.id, name: p.full_name || p.username || 'Someone', username: p.username })) : []
}
