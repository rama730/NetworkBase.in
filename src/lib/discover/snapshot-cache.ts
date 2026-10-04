import { createHash } from 'crypto';

export function buildDiscoverSnapshotKey(input: unknown): string {
    return createHash('sha1').update(JSON.stringify(input)).digest('hex');
}
