import { redis } from '@/lib/redis';
import { revalidatePath } from 'next/cache';

export async function revalidateConnectionsPaths() {
    revalidatePath('/network');
    revalidatePath('/my-profile');
    revalidatePath('/u/[username]', 'page');
    revalidatePath('/messages');
}

// ponytail: Replace keyspace SCAN loop with atomic per-user revision bump for discover and inbox caches. ceiling: Constant 1-hop Redis INCR vs O(keyspace) blocking SCAN. upgrade: TTL-based natural expiry.
export async function invalidateDiscoverCacheForUsers(userIds: Iterable<string | null | undefined>) {
    const uniqueUserIds = Array.from(
        new Set(
            Array.from(userIds).filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
        ),
    );
    if (!redis || uniqueUserIds.length === 0) return;
    try {
        const pipeline = redis.pipeline();
        for (const userId of uniqueUserIds) {
            pipeline.incr(`user:${userId}:discover_revision`);
            pipeline.incr(`user:${userId}:inbox_revision`);
        }
        pipeline.incr('search:preview:people:revision');
        await pipeline.exec();
    } catch (err) {
        // non-blocking best-effort cache revision bump
    }
}

export async function applyConnectionPairsToRedis(
    rows: Array<{ requesterId: string; addresseeId: string }>,
    operation: 'add' | 'remove',
) {
    if (!redis || rows.length === 0) return;
    const uniquePairs = new Map<string, { requesterId: string; addresseeId: string }>();
    for (const row of rows) {
        const key = row.requesterId < row.addresseeId
            ? `${row.requesterId}:${row.addresseeId}`
            : `${row.addresseeId}:${row.requesterId}`;
        uniquePairs.set(key, row);
    }

    const peersByKey = new Map<string, Set<string>>();
    for (const { requesterId, addresseeId } of uniquePairs.values()) {
        const requesterKey = `user:${requesterId}:connections`;
        const addresseeKey = `user:${addresseeId}:connections`;
        const requesterPeers = peersByKey.get(requesterKey) ?? new Set<string>();
        requesterPeers.add(addresseeId);
        peersByKey.set(requesterKey, requesterPeers);
        const addresseePeers = peersByKey.get(addresseeKey) ?? new Set<string>();
        addresseePeers.add(requesterId);
        peersByKey.set(addresseeKey, addresseePeers);
    }

    // A missing set means "unknown" and must stay missing so readers use the
    // database fallback instead of mistaking one incremental pair for a full graph.
    const keys = [...peersByKey.keys()];
    const existencePipeline = redis.pipeline();
    for (const key of keys) existencePipeline.exists(key);
    const existence = await existencePipeline.exec() as unknown[];

    const pipeline = redis.pipeline();
    let mutationCount = 0;
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        if (Number(existence[index] ?? 0) !== 1) continue;
        const peers = [...(peersByKey.get(key) ?? [])];
        if (peers.length === 0) continue;
        if (operation === 'add') {
            for (const peer of peers) pipeline.sadd(key, peer);
            pipeline.expire(key, 86400);
            mutationCount += peers.length + 1;
        } else {
            for (const peer of peers) pipeline.srem(key, peer);
            mutationCount += peers.length;
        }
    }
    if (mutationCount > 0) await pipeline.exec();
}
