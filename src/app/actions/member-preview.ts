'use server';

import { cookies } from 'next/headers';

import { readViewerOrgRole } from '@/lib/organizations/detail';
import { MEMBER_PREVIEW_COOKIE } from '@/lib/organizations/member-preview';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Preview as member (report §45.6, decision 175): only the organization's owner and admins can start one.

export async function startMemberPreviewAction(orgId: string): Promise<{ success: true } | { success: false; error: string }> {
    const { userId } = await getViewerAuthContext();
    const role = userId ? await readViewerOrgRole(orgId, userId, { ignorePreview: true }) : null;
    if (role !== 'owner' && role !== 'admin') return { success: false, error: 'Only owners and admins can preview as a member.' };
    (await cookies()).set(MEMBER_PREVIEW_COOKIE, orgId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 });
    return { success: true };
}

export async function exitMemberPreviewAction(): Promise<{ success: true }> {
    (await cookies()).delete(MEMBER_PREVIEW_COOKIE);
    return { success: true };
}
