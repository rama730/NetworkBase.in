import { inngest } from '../client';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import { counterRefreshMarkerKey } from '@/lib/my-work/counter-buffer';
import { refreshMyWorkCountersForUsers } from '@/lib/my-work/profile-counters';

export const myWorkCountersRefresh = inngest.createFunction(
    { 
        id: 'workspace-counters-refresh', 
        name: 'Workspace Counters Refresh',
        batchEvents: {
            maxSize: 5,
            timeout: '5s',
        },
    },
    [{ event: 'my-work/counters.refresh' }, { event: 'workspace/counters.refresh' }] /* old name drains for one release */,
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
            await refreshMyWorkCountersForUsers(db, userIds);
        });

        return {
            processed: userIds.length,
        };
    }
);
