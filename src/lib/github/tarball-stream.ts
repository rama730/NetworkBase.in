import tar from 'tar-stream';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { shouldIgnorePath, isTooLarge } from '@/lib/import/import-filters';
import { normalizeAndValidateUploadRelativePath, PROJECT_UPLOAD_MAX_FILE_BYTES } from '@/lib/upload/security';

export interface TarballFile {
    path: string; // The path within the repo
    content: Buffer;
}

// 100 MiB cumulative extraction ceiling prevents decompression bombs (zip/gzip bombs)
const MAX_CUMULATIVE_TARBALL_BYTES = 100 * 1024 * 1024;

/**
 * Downloads a tarball from GitHub and yields files sequentially as it streams.
 * Prevents loading the entire repo into memory at once.
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

    const res = await fetch(apiUrl, { headers });
    if (!res.ok || !res.body) {
        throw new Error(`Failed to fetch tarball: ${res.statusText}`);
    }

    const extract = tar.extract();
    const gunzip = zlib.createGunzip();

    let iteratorResolvers: { resolve: (val: any) => void; reject: (err: any) => void }[] = [];
    const fileQueue: TarballFile[] = [];
    let isDone = false;
    let streamError: Error | null = null;
    let totalExtractedBytes = 0;

    extract.on('entry', (header, stream, next) => {
        // GitHub tarballs contain a root directory (e.g. owner-repo-sha/). We want to strip it.
        const parts = header.name.split('/');
        parts.shift(); // remove root folder
        const rawRelativePath = parts.join('/');

        // Defend against Zip Slip path traversal
        let normalizedPath: string;
        try {
            normalizedPath = normalizeAndValidateUploadRelativePath(rawRelativePath);
        } catch {
            stream.resume();
            return next();
        }

        if (header.type !== 'file' || !normalizedPath || shouldIgnorePath(normalizedPath) || isTooLarge(header.size)) {
            stream.resume();
            return next();
        }

        const chunks: Buffer[] = [];
        let entryBytes = 0;
        let entryExceeded = false;

        stream.on('data', (chunk: Buffer) => {
            if (entryExceeded) return;
            entryBytes += chunk.length;
            totalExtractedBytes += chunk.length;

            if (totalExtractedBytes > MAX_CUMULATIVE_TARBALL_BYTES) {
                entryExceeded = true;
                const err = new Error('Archive exceeds maximum decompressed size limit');
                streamError = err;
                stream.destroy(err);
                extract.destroy(err);
                gunzip.destroy(err);
                return;
            }

            if (entryBytes > PROJECT_UPLOAD_MAX_FILE_BYTES) {
                entryExceeded = true;
                // Exceeded per-file limit; discard entry without failing entire archive
                stream.resume();
                return;
            }

            chunks.push(chunk);
        });

        stream.on('end', () => {
            if (!entryExceeded) {
                fileQueue.push({ path: normalizedPath, content: Buffer.concat(chunks) });
                if (iteratorResolvers.length > 0) {
                    iteratorResolvers.shift()!.resolve({ value: fileQueue.shift(), done: false });
                }
            }
            next();
        });
        stream.on('error', (err) => {
            streamError = err;
            if (iteratorResolvers.length > 0) iteratorResolvers.shift()!.reject(err);
        });
    });

    extract.on('finish', () => {
        isDone = true;
        if (iteratorResolvers.length > 0) {
            for (const r of iteratorResolvers) r.resolve({ done: true });
            iteratorResolvers = [];
        }
    });

    extract.on('error', (err) => {
        streamError = err;
        if (iteratorResolvers.length > 0) iteratorResolvers.forEach(r => r.reject(err));
    });

    // Run pipeline in background
    pipeline(Readable.fromWeb(res.body as any), gunzip, extract).catch(err => {
        streamError = err;
        if (iteratorResolvers.length > 0) iteratorResolvers.forEach(r => r.reject(err));
    });

    while (!isDone || fileQueue.length > 0) {
        if (streamError) throw streamError;
        if (fileQueue.length > 0) {
            yield fileQueue.shift()!;
        } else {
            const result = await new Promise<any>((resolve, reject) => {
                iteratorResolvers.push({ resolve, reject });
            });
            if (result.done) break;
            if (result.value) yield result.value;
        }
    }
}
