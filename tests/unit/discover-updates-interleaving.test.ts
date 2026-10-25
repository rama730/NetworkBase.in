import assert from "node:assert/strict";
import { test } from "node:test";

import { feedItemKey, interleaveProjectsAndUpdates } from "@/lib/discover/feed-interleaving";
import type { DiscoverUpdateView, Project } from "@/types/discover";

const project = (id: string) => ({ id }) as Project;
const update = (id: string, projectId: string) => ({ id, projectId }) as DiscoverUpdateView;
const projects = (count: number) => Array.from({ length: count }, (_, index) => project(`p${index + 1}`));
const shape = (items: ReturnType<typeof interleaveProjectsAndUpdates>) => items.map(feedItemKey);

test("one update follows every complete group of three projects", () => {
    const items = interleaveProjectsAndUpdates(projects(7), [update("u1", "x1"), update("u2", "x2"), update("u3", "x3")]);
    assert.deepEqual(shape(items), ["p:p1", "p:p2", "p:p3", "u:u1", "p:p4", "p:p5", "p:p6", "u:u2", "p:p7"]);
});

test("loading more projects never moves an item already on screen", () => {
    const pool = [update("u1", "x1"), update("u2", "x2"), update("u3", "x3"), update("u4", "x4")];
    let previous: string[] = [];
    for (const count of [3, 4, 6, 7, 9, 10, 12]) {
        const next = shape(interleaveProjectsAndUpdates(projects(count), pool));
        assert.deepEqual(next.slice(0, previous.length), previous, `${count} projects must keep what ${previous.length} items showed`);
        previous = next;
    }
});

test("an update is never placed near its own project's card; the slot stays empty instead", () => {
    // The only waiting update belongs to p2, which is inside the spacing window of the first slot.
    const items = interleaveProjectsAndUpdates(projects(3), [update("u1", "p2")]);
    assert.deepEqual(shape(items), ["p:p1", "p:p2", "p:p3"]);
    // A later update that does fit is used for that slot, and the blocked one waits.
    const mixed = interleaveProjectsAndUpdates(projects(3), [update("u1", "p2"), update("u2", "other")]);
    assert.deepEqual(shape(mixed), ["p:p1", "p:p2", "p:p3", "u:u2"]);
});

test("two updates from one project do not sit close together", () => {
    const items = interleaveProjectsAndUpdates(projects(9), [update("u1", "x"), update("u2", "x"), update("u3", "y")]);
    const placed = items.filter((item) => item.kind === "update").map((item) => item.data.id);
    assert.deepEqual(placed.slice(0, 2), ["u1", "u3"], "the second update from x waits until it is spaced out");
});

test("with no project cards the updates stand alone; with no updates it is just the projects", () => {
    assert.deepEqual(shape(interleaveProjectsAndUpdates([], [update("u1", "x"), update("u2", "y")])), ["u:u1", "u:u2"]);
    assert.deepEqual(shape(interleaveProjectsAndUpdates(projects(4), [])), ["p:p1", "p:p2", "p:p3", "p:p4"]);
    assert.deepEqual(interleaveProjectsAndUpdates([], []), []);
});

test("a project id and an update id with the same text keep different keys", () => {
    assert.notEqual(feedItemKey({ kind: "project", data: project("same") }), feedItemKey({ kind: "update", data: update("same", "x") }));
});
