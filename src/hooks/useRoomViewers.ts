'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';
import type { PresenceMemberState } from '@/lib/realtime/presence-types';

/**
 * Review queue §4b.10: who else has this task open now (its presence room — the same one the discussion's typing uses),
 * leaving out the viewer and the given people (the student or team the hand-in belongs to). Nothing is locked; it only
 * tells a second reviewer "Priya is looking at this".
 */
export function useRoomViewers(taskId: string | null, leaveOut: string[] = []) {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const [members, setMembers] = useState<Map<string, PresenceMemberState>>(new Map());
  useEffect(() => {
    if (!taskId || !me) return;
    setMembers(new Map());
    const subscription = subscribePresenceRoom({
      roomType: 'task',
      roomId: taskId,
      role: 'viewer',
      onEvent: (event) => {
        if (event.type === 'presence.state') setMembers(new Map(event.members.map((m) => [m.userId, m])));
        else if (event.type === 'presence.delta') setMembers((cur) => {
          const next = new Map(cur);
          if (event.action === 'leave') next.delete(event.member.userId); else next.set(event.member.userId, event.member);
          return next;
        });
      },
    });
    return () => subscription.unsubscribe();
  }, [taskId, me]);
  const skip = new Set([me, ...leaveOut]);
  return [...members.values()].filter((m) => !skip.has(m.userId)).map((m) => m.profile?.fullName ?? m.userName ?? m.profile?.username ?? 'Someone');
}
