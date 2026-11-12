import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AboutCard } from '../../src/components/profile/v2/sections/AboutCard';
import { DetailsCard } from '../../src/components/profile/v2/sections/DetailsCard';
import { RequestProfileRow } from '../../src/components/network/RequestProfileRow';
import { profileDetailsRows, profileNewMemberLine } from '../../src/lib/profile/details';
import { completionItemSection, PROFILE_EDIT_SECTIONS } from '../../src/lib/profile/edit-route';
import { calculateProfileCompletion } from '../../src/lib/validations/profile';

const now = new Date('2026-11-12T10:00:00Z');
const joined = '2026-11-03T08:00:00Z';
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(element).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');

test('About: a visitor sees one honest line instead of an empty page', () => {
    const visitor = html(createElement(AboutCard, { profile: { fullName: 'Vijay Kumar', username: 'vijay23', bio: '' }, isOwner: false }));
    assert.match(visitor, /Vijay hasn’t written an introduction yet\./);
    assert.doesNotMatch(visitor, /Add bio|Only you can see this/);

    const noName = html(createElement(AboutCard, { profile: { username: 'vijay23', bio: null }, isOwner: false }));
    assert.match(noName, /@vijay23 hasn’t written an introduction yet\./);

    const withBio = html(createElement(AboutCard, { profile: { fullName: 'Vijay Kumar', bio: 'I design things.' }, isOwner: false }));
    assert.match(withBio, /I design things\./);
    assert.doesNotMatch(withBio, /introduction yet/);
});

test('About: the owner gets the prompt, marked as visible only to them', () => {
    const owner = html(createElement(AboutCard, { profile: { fullName: 'Vijay Kumar', bio: '' }, isOwner: true, onEdit: () => {} }));
    assert.match(owner, /Add bio/);
    assert.match(owner, /Only you can see this/);
    assert.doesNotMatch(owner, /introduction yet/);
});

test('Details rows: only filled rows, joined always, nothing repeated from Collaboration preferences', () => {
    const base = { now, viewerTimeZone: 'UTC', createdAt: joined, timeZone: null, interests: [], experienceLevel: null, hoursPerWeek: null };

    const empty = profileDetailsRows({ ...base, isOwner: false, preferencesShownElsewhere: false });
    assert.deepEqual(empty.map((row) => [row.key, row.value]), [['joined', 'November 2026']]);

    const full = profileDetailsRows({ ...base, isOwner: false, preferencesShownElsewhere: false, experienceLevel: 'student', hoursPerWeek: 'h_5_10', interests: ['Open Source', 'AI/ML'] });
    assert.deepEqual(full.map((row) => row.key), ['experience', 'availability', 'interests', 'joined']);
    assert.equal(full[0]!.value, 'Student');
    assert.equal(full[1]!.value, '5–10 hours a week');
    assert.deepEqual(full[2]!.value, ['Open Source', 'AI/ML']);

    // Collaboration preferences already shows experience and availability: never twice on one page.
    const elsewhere = profileDetailsRows({ ...base, isOwner: false, preferencesShownElsewhere: true, experienceLevel: 'student', hoursPerWeek: 'h_5_10' });
    assert.deepEqual(elsewhere.map((row) => row.key), ['joined']);

    // No joined date and nothing else: no rows, so the card hides instead of rendering empty.
    assert.deepEqual(profileDetailsRows({ ...base, createdAt: null, isOwner: false, preferencesShownElsewhere: false }), []);
});

test('Details rows: local time only for visitors, only when it differs, never on a bad zone', () => {
    const base = { now, viewerTimeZone: 'UTC', createdAt: joined, interests: [], experienceLevel: null, hoursPerWeek: null, preferencesShownElsewhere: false };
    const kolkata = profileDetailsRows({ ...base, isOwner: false, timeZone: 'Asia/Kolkata' });
    const local = kolkata.find((row) => row.key === 'localTime');
    assert.ok(local, 'a different zone shows local time');
    assert.equal(local!.value, new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(now));

    assert.equal(profileDetailsRows({ ...base, isOwner: false, timeZone: 'UTC' }).some((row) => row.key === 'localTime'), false, 'same clock: hidden');
    assert.equal(profileDetailsRows({ ...base, isOwner: true, timeZone: 'Asia/Kolkata' }).some((row) => row.key === 'localTime'), false, 'owner: own clock');
    assert.equal(profileDetailsRows({ ...base, isOwner: false, timeZone: 'Not/AZone' }).some((row) => row.key === 'localTime'), false, 'bad zone: hidden');
});

test('Details rows: the owner gets an Add link for missing interests', () => {
    const rows = profileDetailsRows({ now, viewerTimeZone: 'UTC', createdAt: joined, timeZone: null, interests: [], experienceLevel: null, hoursPerWeek: null, isOwner: true, preferencesShownElsewhere: true });
    const interests = rows.find((row) => row.key === 'interests');
    assert.ok(interests);
    assert.equal(interests!.value, null);
    assert.equal(interests!.addHref, '/my-profile/edit?section=skills');
});

test('Details card renders rows and hides when there are none', () => {
    const rendered = html(createElement(DetailsCard, { rows: profileDetailsRows({ now, viewerTimeZone: 'UTC', createdAt: joined, timeZone: null, interests: ['Startups'], experienceLevel: 'student', hoursPerWeek: null, isOwner: false, preferencesShownElsewhere: false }) }));
    assert.match(rendered, />Details</);
    assert.match(rendered, /Student/);
    assert.match(rendered, /Startups/);
    assert.match(rendered, /November 2026/);
    assert.equal(html(createElement(DetailsCard, { rows: [] })), '');

    const owner = html(createElement(DetailsCard, { rows: profileDetailsRows({ now, viewerTimeZone: 'UTC', createdAt: joined, timeZone: null, interests: [], experienceLevel: null, hoursPerWeek: null, isOwner: true, preferencesShownElsewhere: true }) }));
    assert.match(owner, /Add interests/);
    assert.match(owner, /href="\/my-profile\/edit\?section=skills"/);
});

test('Header: visitors see New member instead of zero counts; owners keep their counts', () => {
    assert.equal(profileNewMemberLine({ isOwner: false, connectionsCount: 0, workspacesCount: 0, createdAt: joined }), 'New member · joined Nov 2026');
    assert.equal(profileNewMemberLine({ isOwner: false, connectionsCount: 0, workspacesCount: 0, createdAt: null }), 'New member');
    assert.equal(profileNewMemberLine({ isOwner: false, connectionsCount: 1, workspacesCount: 0, createdAt: joined }), null);
    assert.equal(profileNewMemberLine({ isOwner: false, connectionsCount: 0, workspacesCount: 2, createdAt: joined }), null);
    assert.equal(profileNewMemberLine({ isOwner: true, connectionsCount: 0, workspacesCount: 0, createdAt: joined }), null);
});

test('Completion: every missing item opens the edit section that holds it', () => {
    const { missing } = calculateProfileCompletion({});
    assert.ok(missing.length >= 9);
    for (const item of missing) assert.ok(PROFILE_EDIT_SECTIONS.includes(completionItemSection(item)), item);
    assert.equal(completionItemSection('Add headline'), 'general');
    assert.equal(completionItemSection('Add profile photo'), 'general');
    assert.equal(completionItemSection('Add at least 3 skills'), 'skills');
    assert.equal(completionItemSection('Add at least 1 social link'), 'social');
    assert.equal(completionItemSection(undefined), 'general');
});

test('Request row: never a bare name, never the location twice', () => {
    const row = (profile: Partial<{ headline: string | null; location: string | null }>) => html(createElement(RequestProfileRow, {
        profile: { id: '1', username: 'vijay23', fullName: 'Vijay Kumar', avatarUrl: null, headline: null, location: null, ...profile },
        requestedAt: now,
        actions: null,
    }));
    assert.match(row({}), /@vijay23/);
    const locationOnly = row({ location: 'Vijayawada' });
    assert.equal(locationOnly.split('Vijayawada').length - 1, 1);
    const both = row({ headline: 'Designer', location: 'Vijayawada' });
    assert.match(both, /Designer/);
    assert.match(both, /Vijayawada/);
});
