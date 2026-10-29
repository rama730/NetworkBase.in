import type { ProjectUpdateView } from "@/app/actions/workspace/updates";
import type { DiscoverUpdateView } from "@/types/discover";

/**
 * A Discover update in the shape the shared thread panel reads. What Discover never sends (linked work,
 * metadata, storage keys) is empty here rather than guessed, and a masked author keeps no identity.
 */
export function toProjectUpdateView(update: DiscoverUpdateView): ProjectUpdateView {
    const author = update.author;
    return {
        id: update.id,
        projectId: update.projectId,
        authorId: author?.id ?? null,
        author: author
            ? {
                id: author.id,
                fullName: author.masked ? "Private member" : author.fullName,
                username: author.masked ? null : author.username,
                avatarUrl: author.masked ? null : author.avatarUrl,
                roleLabel: author.masked ? null : author.roleLabel,
                roleTitle: null,
                membershipRoleLabel: null,
                roleSource: null,
            }
            : null,
        content: update.content,
        updateType: update.updateType,
        visibility: "public",
        replyPolicy: update.replyPolicy,
        entityRefs: {},
        context: {},
        media: update.media.map((item) => ({ ...item, assetId: null, bucket: null, storageKey: null })),
        metadata: {},
        isPinned: update.isPinned,
        pinnedUntil: null,
        audience: {},
        fromProject: null,
        likeCount: update.likeCount,
        commentCount: update.commentCount,
        likedByViewer: update.likedByViewer,
        canEdit: update.canEdit,
        canDelete: update.canDelete,
        canPin: false,
        canComment: update.canComment,
        editedAt: update.editedAt,
        deletedAt: null,
        createdAt: update.createdAt,
        updatedAt: update.editedAt ?? update.createdAt,
    };
}
