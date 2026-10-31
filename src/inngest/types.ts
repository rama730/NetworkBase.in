
import { EventSchemas } from "inngest";
import type { NotificationFanoutEvent } from "@/lib/notifications/types";

type ProjectImportEvent = {
    data: {
        projectId: string;
        importSource: {
            type: 'github';
            repoUrl: string;
            branch?: string;
            metadata?: any;
        };
        userId: string;
        /** The commit the manifest was captured at; hydration downloads exactly this tree. */
        commitSha?: string;
    };
};

type GitPushEvent = {
    data: {
        runId?: string;
        projectId: string;
        commitMessage: string;
        userId: string;
        jobSignature: string;
    };
};

type GitPullEvent = {
    data: {
        runId?: string;
        projectId: string;
        userId: string;
        branch?: string | null;
        deliveryId?: string | null;
        afterSha?: string | null;
        source?: "webhook" | "manual" | "system";
        jobSignature: string;
    };
};

type AccountCleanupEvent = {
    data: {
        userId: string;
        deletionId: string;
        jobSignature: string;
    };
};

type MyWorkCountersRefreshEvent = {
    data: {
        userId: string;
    };
};

type ConnectionsSyncSuggestionsEvent = {
    data: {
        userId: string;
    };
};

type NotificationFanoutInngestEvent = {
    data: NotificationFanoutEvent;
};

type ProjectUpdateCleanupEvent = {
    data: {
        projectId: string;
        updateId: string;
    };
};

type ProfileImageCleanupEvent = {
    data: {
        userId: string;
        storageKey: string;
    };
};

type ConnectionsRefreshSuggestionCandidateEvent = {
    data: {
        candidateUserId: string;
    };
};

export const schemas = new EventSchemas().fromRecord<{
    "workspace/import": ProjectImportEvent;
    /** Old name (report §12.5): queued before the rename; drop after one release. */
    "project/import": ProjectImportEvent;
    "workspace/import.hydrate": ProjectImportEvent;
    /** Old name (report §12.5): queued before the rename; drop after one release. */
    "project/import.hydrate": ProjectImportEvent;
    "git/push": GitPushEvent;
    "git/pull": GitPullEvent;
    "account/cleanup": AccountCleanupEvent;
    "my-work/counters.refresh": MyWorkCountersRefreshEvent;
    /** Old name (report §12.5): queued before the rename; drop after one release. */
    "workspace/counters.refresh": MyWorkCountersRefreshEvent;
    "connections/sync_suggestions": ConnectionsSyncSuggestionsEvent;
    /** Old name (report §12.5): queued before the rename; drop after one release. */
    "workspace/connections.sync_suggestions": ConnectionsSyncSuggestionsEvent;
    "connections/refresh_suggestions_for_candidate": ConnectionsRefreshSuggestionCandidateEvent;
    /** Old name (report §12.5): queued before the rename; drop after one release. */
    "workspace/connections.refresh_suggestions_for_candidate": ConnectionsRefreshSuggestionCandidateEvent;
    "notification/fanout": NotificationFanoutInngestEvent;
    "email/outbox.wake": { data: Record<string, never> };
    "chat/due.wake": { data: Record<string, never> };
    "notification/push.wake": { data: Record<string, never> };
    /** Organizations P15: Duplicate runs in the background (report §30.5). */
    /** Reporting (docs/trust-and-safety-concept.md §11): an Urgent case alerts staff at once. */
    "trust/urgent.reported": { data: { caseId: string } };
    /** A decision's notices go out once its 10-second Undo has passed (C8). */
    "trust/decision.made": { data: { caseId: string } };
    "org/duplicate.requested": { data: { sourceId: string; actorId: string; options: import("@/lib/organizations/lifecycle").DuplicateOptions } };
    "workspace/updates.cleanup": ProjectUpdateCleanupEvent;
    /** Old name (report §12.5): queued before the rename; drop after one release. */
    "project/updates.cleanup": ProjectUpdateCleanupEvent;
    "storage/profile-image.cleanup": ProfileImageCleanupEvent;
}>();
