import assert from "node:assert/strict";
import test from "node:test";
import { queryKeys } from "../../src/lib/query-keys";
import type { ProjectUpdateLikerView } from "../../src/app/actions/workspace/updates";

test("queryKeys.project.detail.updateLikes builds deterministic query keys", () => {
    const key = queryKeys.project.detail.updateLikes("proj-123", "update-456");
    assert.deepEqual(key, ["project", "proj-123", "detail", "updates", "update-456", "likes"]);
});

test("queryKeys.project.detail.updateLikes handles null updateId gracefully", () => {
    const key = queryKeys.project.detail.updateLikes("proj-123", null);
    assert.deepEqual(key, ["project", "proj-123", "detail", "updates", null, "likes"]);
});

test("ProjectUpdateLikerView model conforms to lightweight profile view contract", () => {
    const liker: ProjectUpdateLikerView = {
        key: "like-1",
        userId: "user-1",
        username: "johndoe",
        fullName: "John Doe",
        avatarUrl: "https://example.com/avatar.png",
        headline: "Founding Engineer",
        likedAt: new Date().toISOString(),
        isViewer: true,
    };

    assert.equal(liker.userId, "user-1");
    assert.equal(liker.username, "johndoe");
    assert.equal(liker.isViewer, true);
    assert.ok(liker.likedAt);
});
