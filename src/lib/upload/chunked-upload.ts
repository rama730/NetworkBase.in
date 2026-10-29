'use client';

import { buildProjectFileKey } from '@/lib/storage/workspace-file-key';
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client';

export interface UploadProgress {
    totalFiles: number;
    uploadedFiles: number;
    totalBytes: number;
    uploadedBytes: number;
    currentFile: string;
    percent: number;
}

export interface UploadResult {
    success: boolean;
    uploadedKeys: string[];
    uploadedAssets: Array<{ requestKey: string; storageKey: string; uploadIntentId: string }>;
    failedFiles: string[];
}

export type PreparedFolderUpload = {
    url: string;
    uploadToken: string;
    storageKey: string;
    uploadIntentId: string;
};

export interface UploadFolderOptions {
    signal?: AbortSignal;
    sessionId?: string;
    manifestHash?: string;
    maxConcurrency?: number;
    alreadyUploadedKeys?: Iterable<string>;
}

type UploadTask = {
    file: File;
    relativePath: string;
    s3Key: string;
};

const DEFAULT_MIN_CONCURRENCY = 2;
const DEFAULT_MAX_CONCURRENCY = 4;

function resolveUploadOptions(signalOrOptions?: AbortSignal | UploadFolderOptions): UploadFolderOptions {
    if (!signalOrOptions) return {};
    if (signalOrOptions instanceof AbortSignal) {
        return { signal: signalOrOptions };
    }
    return signalOrOptions;
}

function detectAdaptiveConcurrency(): number {
    let base = 5;
    if (typeof navigator !== 'undefined') {
        const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
        const effectiveType = nav.connection?.effectiveType || '';
        if (effectiveType.includes('2g')) base = 2;
        else if (effectiveType.includes('3g')) base = 3;
        else if (effectiveType.includes('4g')) base = 6;
        if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0) {
            base = Math.min(base, Math.max(2, Math.floor(navigator.hardwareConcurrency / 2)));
        }
    }
    return Math.min(DEFAULT_MAX_CONCURRENCY, Math.max(DEFAULT_MIN_CONCURRENCY, base));
}

function createTasks(files: FileList, projectId: string): UploadTask[] {
    const tasks: UploadTask[] = [];
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (!file) continue;
        const relativePath = file.webkitRelativePath || file.name;
        tasks.push({
            file,
            relativePath,
            s3Key: buildProjectFileKey(projectId, relativePath),
        });
    }
    // Upload larger files first so tail latency is lower and retries are front-loaded.
    tasks.sort((a, b) => b.file.size - a.file.size);
    return tasks;
}

/**
 * Upload a folder of files with adaptive bounded concurrency and deterministic retry budget.
 * Backward compatible:
 * - previous signature accepted AbortSignal as the last argument
 * - current signature also accepts UploadFolderOptions
 */
export async function uploadFolder(
    files: FileList,
    projectId: string,
    onProgress: (progress: UploadProgress) => void,
    getPresignedUrl: (fileName: string, contentType: string, sizeBytes: number) => Promise<PreparedFolderUpload>,
    signalOrOptions?: AbortSignal | UploadFolderOptions,
): Promise<UploadResult> {
    const options = resolveUploadOptions(signalOrOptions);
    const signal = options.signal;
    const totalBytes = Array.from(files).reduce((sum, file) => sum + file.size, 0);
    const tasks = createTasks(files, projectId);
    const uploadedKeysFromResume = new Set(options.alreadyUploadedKeys || []);
    const queuedTasks = tasks.filter((task) => !uploadedKeysFromResume.has(task.s3Key));
    const result: UploadResult = {
        success: true,
        uploadedKeys: Array.from(uploadedKeysFromResume),
        uploadedAssets: [],
        failedFiles: [],
    };

    if (tasks.length === 0) {
        onProgress({
            totalFiles: 0,
            uploadedFiles: 0,
            totalBytes: 0,
            uploadedBytes: 0,
            currentFile: '',
            percent: 100,
        });
        return result;
    }

    let completedBytes = tasks
        .filter((task) => uploadedKeysFromResume.has(task.s3Key))
        .reduce((sum, task) => sum + task.file.size, 0);
    let uploadedFiles = uploadedKeysFromResume.size;
    const inFlightBytes = new Map<string, number>();
    let currentFile = '';

    const emitProgress = () => {
        const inFlightTotal = Array.from(inFlightBytes.values()).reduce((sum, v) => sum + v, 0);
        const uploadedBytes = Math.min(totalBytes, completedBytes + inFlightTotal);
        onProgress({
            totalFiles: tasks.length,
            uploadedFiles,
            totalBytes,
            uploadedBytes,
            currentFile,
            percent: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100,
        });
    };

    const concurrency = Math.min(
        Math.max(1, options.maxConcurrency || detectAdaptiveConcurrency()),
        Math.max(1, queuedTasks.length),
    );
    let cursor = 0;

    const runTask = async (task: UploadTask) => {
        if (signal?.aborted) throw new Error('Upload canceled');

        currentFile = task.relativePath;
        emitProgress();
        try {
            const contentType = task.file.type || 'application/octet-stream';
            const prepared = await getPresignedUrl(task.s3Key, contentType, task.file.size);
            await uploadToSupabaseSignedUrl({
                bucket: 'project-files',
                storagePath: prepared.storageKey,
                uploadToken: prepared.uploadToken,
                uploadUrl: prepared.url,
                contentType,
                operationId: prepared.uploadIntentId,
                accountScope: options.sessionId,
            }, task.file, {
                cacheProfile: 'immutable',
                signal,
                onProgress: (uploaded) => {
                    inFlightBytes.set(task.s3Key, uploaded);
                    currentFile = task.relativePath;
                    emitProgress();
                },
            });
            inFlightBytes.delete(task.s3Key);
            completedBytes += task.file.size;
            uploadedFiles += 1;
            result.uploadedKeys.push(task.s3Key);
            result.uploadedAssets.push({
                requestKey: task.s3Key,
                storageKey: prepared.storageKey,
                uploadIntentId: prepared.uploadIntentId,
            });
            emitProgress();
        } catch (error) {
            inFlightBytes.delete(task.s3Key);
            if (signal?.aborted) throw new Error('Upload canceled');
            console.error('Failed to upload file', {
                relativePath: task.relativePath,
                sessionId: options.sessionId || null,
                manifestHash: options.manifestHash || null,
                error,
            });
            result.failedFiles.push(task.relativePath);
            emitProgress();
        }
    };

    const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= queuedTasks.length) return;
            const task = queuedTasks[index];
            if (task) {
                await runTask(task);
            }
        }
    });

    await Promise.all(workers);

    result.success = result.failedFiles.length === 0;
    const finalUploadedBytes = Math.min(totalBytes, completedBytes);
    onProgress({
        totalFiles: tasks.length,
        uploadedFiles,
        totalBytes,
        uploadedBytes: finalUploadedBytes,
        currentFile: '',
        percent: totalBytes > 0 ? Math.round((finalUploadedBytes / totalBytes) * 100) : 100,
    });

    return result;
}
