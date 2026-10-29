import tar from 'tar-stream';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { shouldIgnorePath, isTooLarge } from '@/lib/import/import-filters';
import { normalizeAndValidateUploadRelativePath, WORKSPACE_UPLOAD_MAX_FILE_BYTES } from '@/lib/upload/security';

export interface TarballFile {
    path: string; // The path within the repo
    content: Buffer;
}

// 100 MiB cumulative extraction ceiling prevents decompression bombs (zip/gzip bombs).
// It counts every byte actually inflated, skipped entries included.
const MAX_CUMULATIVE_TARBALL_BYTES = 100 * 1024 * 1024;
const MAX_TARBALL_ENTRIES = 50_000;
/** Covers connecting, downloading and extracting: a stalled download cannot hold a worker open. */
const TARBALL_DEADLINE_MS = 5 * 60 * 1000;

/**
 * Downloads a tarball from GitHub and yields files as it streams. Extraction runs at most one file
 * ahead of the consumer (PERF-001): the next entry is not read until the previous one is taken, so
 * memory stays near two files however slowly files are processed. Stopping early cancels the download.
 */
export async function* fetchAndParseTarball(
    repoUrl: string,
    ref: string, // a commit SHA for reproducible reads; a branch name reads whatever it points to now
    token?: string
): AsyncGenerator<TarballFile, void, unknown> {
    const urlParts = repoUrl.replace(/\/$/, '').split('/');
    const repoName = urlParts.pop();
    const ownerName = urlParts.pop();
    const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/tarball/${ref}`;

    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'nb-s3-importer',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('Tarball download timed out')), TARBALL_DEADLINE_MS);
    const extract = tar.extract();
    const gunzip = zlib.createGunzip();
    let closed = false;
    try {
        const res = await fetch(apiUrl, { headers, signal: controller.signal });
        if (!res.ok || !res.body) {
            throw new Error(`Couldn’t fetch tarball: ${res.statusText}`);
        }

        let ready: TarballFile | null = null; // the one file extracted ahead of the consumer
        let releaseProducer: (() => void) | null = null; // the held `next()` of the entry that produced it
        let wakeConsumer: (() => void) | null = null;
        let finished = false;
        let failure: Error | null = null;
        let totalBytes = 0;
        let entries = 0;

        const wake = () => { const resume = wakeConsumer; wakeConsumer = null; resume?.(); };
        const fail = (error: Error) => {
            if (closed || failure) return;
            failure = error;
            controller.abort(error);
            wake();
        };
        const account = (bytes: number) => {
            totalBytes += bytes;
            if (totalBytes > MAX_CUMULATIVE_TARBALL_BYTES) fail(new Error('Archive exceeds maximum decompressed size limit'));
        };

        extract.on('entry', (header, stream, next) => {
            stream.on('data', (chunk: Buffer) => account(chunk.length));
            stream.on('error', fail);

            // GitHub tarballs contain a root directory (e.g. owner-repo-sha/). We want to strip it.
            const parts = header.name.split('/');
            parts.shift(); // remove root folder
            const rawRelativePath = parts.join('/');

            // Defend against Zip Slip path traversal
            let normalizedPath = '';
            try {
                normalizedPath = normalizeAndValidateUploadRelativePath(rawRelativePath);
            } catch {
                // skipped below
            }

            if (++entries > MAX_TARBALL_ENTRIES) return fail(new Error('Archive contains too many entries'));
            if (header.type !== 'file' || !normalizedPath || shouldIgnorePath(normalizedPath) || isTooLarge(header.size)) {
                stream.on('end', next);
                stream.resume();
                return;
            }

            const chunks: Buffer[] = [];
            let entryBytes = 0;
            let oversize = false;
            stream.on('data', (chunk: Buffer) => {
                entryBytes += chunk.length;
                if (entryBytes > WORKSPACE_UPLOAD_MAX_FILE_BYTES) {
                    // Over the per-file limit: discard this entry without failing the archive.
                    oversize = true;
                    chunks.length = 0;
                    return;
                }
                if (!oversize) chunks.push(chunk);
            });
            stream.on('end', () => {
                if (oversize) return next();
                ready = { path: normalizedPath, content: Buffer.concat(chunks) };
                releaseProducer = next;
                wake();
            });
        });
        extract.on('finish', () => { finished = true; wake(); });
        extract.on('error', fail);

        pipeline(Readable.fromWeb(res.body as any), gunzip, extract, { signal: controller.signal }).catch((error) => fail(error));

        for (;;) {
            if (failure) throw failure;
            if (ready) {
                const file: TarballFile = ready;
                ready = null;
                const resume = releaseProducer as (() => void) | null;
                releaseProducer = null;
                resume?.(); // let extraction continue while the consumer works on `file`
                yield file;
                continue;
            }
            if (finished) return;
            await new Promise<void>((resolve) => { wakeConsumer = resolve; });
        }
    } finally {
        closed = true;
        clearTimeout(deadline);
        controller.abort();
        extract.destroy();
        gunzip.destroy();
    }
}
