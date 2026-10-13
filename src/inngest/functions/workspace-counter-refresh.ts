import { inngest } from '../client';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import { counterRefreshMarkerKey } from '@/lib/workspace/counter-buffer';
import { refreshWorkspaceCountersForUsers } from '@/lib/workspace/profile-counters';

export const workspaceCountersRefresh = inngest.createFunction(
    { 
        id: 'workspace-counters-refresh', 
        name: 'Workspace Counters Refresh',
        batchEvents: {
            maxSize: 5,
            timeout: '5s',
        },
    },
    { event: 'workspace/counters.refresh' },
    async ({ events, step }) => {
        const userIds = [...new Set(events.map(e => e.data.userId).filter(Boolean))];
        
        await step.run('refresh-counters', async () => {
            if (userIds.length === 0) return;
            // Clear the queued markers first so mutations during this refresh queue the next one.
            const redis = getRedisClient();
            if (redis) {
                await redis.del(...userIds.map(counterRefreshMarkerKey));
            }

            // Perform batched refresh
            await refreshWorkspaceCountersForUsers(db, userIds);
        });

        return {
            processed: userIds.length,
        };
    }
);
