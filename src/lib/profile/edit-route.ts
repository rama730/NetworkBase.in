export const PROFILE_EDIT_SECTIONS = ['general', 'experience', 'skills', 'social', 'opportunity'] as const;
export type ProfileEditSection = typeof PROFILE_EDIT_SECTIONS[number];

export function parseProfileEditSection(value: unknown): ProfileEditSection {
    return PROFILE_EDIT_SECTIONS.includes(value as ProfileEditSection) ? value as ProfileEditSection : 'general';
}

export function profileEditHref(
    section: ProfileEditSection = 'general', 
    returnTab: string = 'overview',
    extraParams?: Record<string, string | null | undefined>
): string {
    const params = new URLSearchParams({ section: parseProfileEditSection(section) });
    if (returnTab === 'portfolio') params.set('returnTab', 'portfolio');
    if (extraParams) {
        for (const [key, value] of Object.entries(extraParams)) {
            if (value) params.set(key, value);
        }
    }
    return `/my-profile/edit?${params}`;
}

export function profileEditReturnHref(returnTab: unknown): string {
    return returnTab === 'portfolio' ? '/my-profile?tab=portfolio' : '/my-profile';
}
