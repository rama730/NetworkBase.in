import type { UploadedAttachment } from '@/app/actions/messaging';

export type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';
export type StructuredComposerKind =
    | 'project_invite'
    | 'feedback_request'
    | 'availability_request'
    | 'task_approval'
    | 'rate_share'
    | 'handoff_summary';

export interface PendingAttachment {
    id: string;
    file: File;
    preview?: string;
    tinyBase64?: string;
    status: UploadStatus;
    progress: number;
    attempts: number;
    width?: number;
    height?: number;
    uploaded?: UploadedAttachment;
    error?: string;
}

export const MAX_UPLOAD_RETRIES = 3;

