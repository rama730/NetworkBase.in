import assert from 'node:assert/strict';
import test from 'node:test';
import { localDraft,
    changeSummary,
    contributionDate,
    currentRoles,
    filterCounts,
    freeUsernames,
    mergeConflict,
    normalizeWebsite,
    orderContributions,
    websiteError,
} from '../../src/lib/profile/mix';

test('contributionDate: current work reads Now and since; past work reads the year and the range', () => {
    assert.deepEqual(contributionDate({ startDate: '2026-07-01', endDate: null, currentlyActive: true }), { now: true, top: 'Now', sub: 'Since Jul 2026' });
    assert.deepEqual(contributionDate({ startDate: '2025-03-01', endDate: '2025-12-01', currentlyActive: false }), { now: false, top: '2025', sub: 'Mar – Dec' });
    // a start with no end is still going
    assert.equal(contributionDate({ startDate: '2026-02-01', endDate: null, currentlyActive: false }).now, true);
    // a range across years names both years
    assert.equal(contributionDate({ startDate: '2024-11-01', endDate: '2025-02-01', currentlyActive: false }).sub, 'Nov 2024 – Feb 2025');
    // no dates at all
    assert.deepEqual(contributionDate({ startDate: null, endDate: null, currentlyActive: false }), { now: false, top: '', sub: '' });
});

test('currentRoles keeps three and counts the rest', () => {
    const items = [1, 2, 3, 4, 5];
    assert.deepEqual(currentRoles(items), { shown: [1, 2, 3], more: 2 });
    assert.deepEqual(currentRoles([1]), { shown: [1], more: 0 });
});

test('filterCounts splits organizations, workspaces and outside projects', () => {
    const counts = filterCounts([
        { projectId: 'o', projectKind: 'organization' },
        { projectId: 'w', projectKind: 'workspace' },
        { projectId: 'w2', projectKind: null },
        { projectId: null, projectKind: null },
    ]);
    assert.deepEqual(counts, { all: 4, org: 1, workspace: 2, outside: 1 });
});

test('orderContributions: pinned first, then the chosen order, then newest start', () => {
    const list = orderContributions([
        { id: 'a', featured: false, profileOrder: null, startDate: '2026-01-01' },
        { id: 'b', featured: false, profileOrder: 2, startDate: '2020-01-01' },
        { id: 'c', featured: true, profileOrder: null, startDate: '2019-01-01' },
        { id: 'd', featured: false, profileOrder: 1, startDate: '2018-01-01' },
        { id: 'e', featured: false, profileOrder: null, startDate: '2027-01-01' },
    ]);
    assert.deepEqual(list.map((x) => x.id), ['c', 'd', 'b', 'e', 'a']);
});

test('orderContributions: once you move entries on the timeline, that order wins over the Organizations order', () => {
    const list = orderContributions([
        { id: 'org', featured: false, profileOrder: 1, timelineOrder: 2, startDate: '2026-01-01' },
        { id: 'ws', featured: false, profileOrder: null, timelineOrder: 0, startDate: '2020-01-01' },
        { id: 'old', featured: false, profileOrder: null, timelineOrder: 1, startDate: '2019-01-01' },
        { id: 'new', featured: false, profileOrder: 0, timelineOrder: null, startDate: '2027-01-01' },
    ]);
    // A new entry (no order yet) comes first, so a new workspace shows in Recent work instead of sinking.
    assert.deepEqual(list.map((x) => x.id), ['new', 'ws', 'old', 'org']);
});

test('changeSummary says what changed in words', () => {
    assert.equal(changeSummary('skills', ['A', 'B'], ['B', 'A']), 'Reordered');
    assert.equal(changeSummary('skills', ['A'], ['A', 'React', 'Go', 'Rust']), '+React, +Go +1 more');
    assert.equal(changeSummary('skills', ['A', 'B'], ['A', 'C']), '+C · −B');
    assert.equal(changeSummary('photo', 'pixel', 'new'), 'Added');
    assert.equal(changeSummary('photo', 'photo', 'new'), 'New photo');
    assert.equal(changeSummary('photo', 'photo', 'pixel'), 'Removed');
    assert.equal(changeSummary('openToCollaborate', false, true), 'Turned on');
    assert.equal(changeSummary('openToCollaborate', true, false), 'Turned off');
    assert.equal(changeSummary('username', 'samrivera', 'sam_r'), '@samrivera → @sam_r');
    assert.equal(changeSummary('headline', '', 'Hi'), 'Added');
    assert.equal(changeSummary('headline', 'Hi', 'Hello'), 'Edited');
    assert.equal(changeSummary('headline', 'Hi', ''), 'Removed');
});

test('mergeConflict: a field both sides changed is a clash; a field only the other tab changed is merged', () => {
    const base = { headline: 'A', location: 'X', bio: 'B' };
    const mine = { headline: 'Mine', location: 'X', bio: 'B2' };
    const theirs = { headline: 'Theirs', location: 'Y', bio: 'B' };
    const { merged, clashes } = mergeConflict(base, mine, theirs, ['headline', 'location', 'bio']);
    assert.deepEqual(clashes, { headline: 'Theirs' });
    assert.equal(merged.location, 'Y');
    assert.equal(merged.bio, 'B2');
    assert.equal(merged.headline, 'Mine');
    // both made the same change: no clash
    assert.deepEqual(mergeConflict({ a: 1 }, { a: 2 }, { a: 2 }, ['a']).clashes, {});
});

test('freeUsernames offers three names of at most 20 characters', () => {
    assert.deepEqual(freeUsernames('samr'), ['samr1', 'samr_dev', 'samr26']);
    const long = freeUsernames('abcdefghijklmnopqrst');
    assert.equal(long.length, 3);
    for (const name of long) assert.ok(name.length <= 20);
    assert.equal(new Set(long).size, 3);
});

test('website: https is added; a broken address is named', () => {
    assert.equal(normalizeWebsite('example.com'), 'https://example.com');
    assert.equal(normalizeWebsite(' http://a.dev '), 'http://a.dev');
    assert.equal(normalizeWebsite(''), '');
    assert.equal(websiteError('https://example.com/work'), null);
    assert.equal(websiteError(''), null);
    assert.equal(websiteError('https://nope'), 'Enter a full address, like https://example.com');
    assert.equal(websiteError('not a url'), 'Enter a full address, like https://example.com');
});

test('localDraft keeps only changed fields and never a photo that is still uploading', () => {
    const base = { headline: 'Old', avatarUrl: 'https://cdn/a.jpg', skills: ['A'] };
    assert.deepEqual(localDraft({ headline: 'New', avatarUrl: 'blob:http://x/1', skills: ['A'] }, base, ['headline', 'avatarUrl', 'skills']), { headline: 'New' });
    assert.deepEqual(localDraft({ headline: ' Old ', avatarUrl: 'https://cdn/b.jpg', skills: ['A', 'B'] }, base, ['headline', 'avatarUrl', 'skills']), { avatarUrl: 'https://cdn/b.jpg', skills: ['A', 'B'] });
});
