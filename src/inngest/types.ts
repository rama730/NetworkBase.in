
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

type WorkspaceCountersRefreshEvent = {
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
    "project/import": ProjectImportEvent;
    "project/import.hydrate": ProjectImportEvent;
    "git/push": GitPushEvent;
    "git/pull": GitPullEvent;
    "account/cleanup": AccountCleanupEvent;
    "workspace/counters.refresh": WorkspaceCountersRefreshEvent;
    "workspace/connections.sync_suggestions": ConnectionsSyncSuggestionsEvent;
    "workspace/connections.refresh_suggestions_for_candidate": ConnectionsRefreshSuggestionCandidateEvent;
    "notification/fanout": NotificationFanoutInngestEvent;
    "email/outbox.wake": { data: Record<string, never> };
    /** Organizations P15: Duplicate runs in the background (report §30.5). */
    "org/duplicate.requested": { data: { sourceId: string; actorId: string; options: import("@/lib/organizations/lifecycle").DuplicateOptions } };
    "project/updates.cleanup": ProjectUpdateCleanupEvent;
    "storage/profile-image.cleanup": ProfileImageCleanupEvent;
}>();
