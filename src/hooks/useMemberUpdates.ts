'use client';

import { useEffect, useRef } from 'react';

import { followWorkspaceTopic } from '@/hooks/useWorkspaceLiveCounts';

/**
 * Someone's part here changed: completed, reopened, left, confirmed or settings (member settings §7, gap 24). Member
 * lists, pickers and Your part refresh; a dropped connection catches up the same way.
 */
export function useMemberUpdates(workspaceId: string | undefined, onChange: () => void) {
    const latest = useRef(onChange);
    latest.current = onChange;
    useEffect(() => {
        if (!workspaceId) return;
        return followWorkspaceTopic(workspaceId, (event) => { if (event === 'member.updated') latest.current(); }, () => latest.current());
    }, [workspaceId]);
}
