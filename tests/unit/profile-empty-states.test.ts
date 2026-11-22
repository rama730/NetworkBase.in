import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AboutSection } from '../../src/components/profile/v2/sections/AboutSection';
import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileFactsCard } from '../../src/components/profile/v2/sections/ProfileFactsCard';
import { RequestProfileRow } from '../../src/components/network/RequestProfileRow';
import { profileDetailsRows, profileNewMemberLine } from '../../src/lib/profile/details';
import { completionItemSection, PROFILE_EDIT_SECTIONS } from '../../src/lib/profile/edit-route';
import { calculateProfileCompletion } from '../../src/lib/validations/profile';

const now = new Date('2026-11-12T10:00:00Z');
const joined = '2026-11-03T08:00:00Z';
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(element).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');

test('About: a visitor sees one honest line instead of an empty page', () => {
    const visitor = html(createElement(AboutSection, { profile: { fullName: 'Vijay Kumar', username: 'vijay23', bio: '' }, isOwner: false, current: [] }));
    assert.match(visitor, /Vijay hasn’t written an introduction yet\./);
    assert.doesNotMatch(visitor, /Add an introduction|Only you can see this/);

    const noName = html(createElement(AboutSection, { profile: { username: 'vijay23', bio: null }, isOwner: false, current: [] }));
    assert.match(noName, /@vijay23 hasn’t written an introduction yet\./);

    const withBio = html(createElement(AboutSection, { profile: { fullName: 'Vijay Kumar', bio: 'I design things.' }, isOwner: false, current: [] }));
    assert.match(withBio, /I design things\./);
    assert.doesNotMatch(withBio, /introduction yet/);
});

test('About: the owner gets the prompt, marked as visible only to them', () => {
    const owner = html(createElement(AboutSection, { profile: { fullName: 'Vijay Kumar', bio: '' }, isOwner: true, current: [], onEdit: () => {} }));
    assert.match(owner, /Add an introduction/);
    assert.match(owner, /Only you can see this until you add one/);
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

/** The right card, rendered once like the page does; Details rows come from profileDetailsRows. */
const card = (props: { detailsRows: ReturnType<typeof profileDetailsRows>; isOwner?: boolean; profile?: Record<string, unknown>; onEditSection?: () => void }) =>
    html(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ProfileFactsCard, {
        profile: { id: '11111111-1111-4111-8111-111111111111', fullName: 'Vijay Kumar', profileStrength: 100, ...props.profile },
        isOwner: props.isOwner ?? false, isAuthenticated: true, contributions: [], detailsRows: props.detailsRows, onEditSection: props.onEditSection,
    })));

test('Details renders rows and hides when there are none', () => {
    const rendered = card({ detailsRows: profileDetailsRows({ now, viewerTimeZone: 'UTC', createdAt: joined, timeZone: null, interests: ['Startups'], experienceLevel: 'student', hoursPerWeek: null, isOwner: false, preferencesShownElsewhere: false }) });
    assert.match(rendered, />Details</);
    assert.match(rendered, /Student/);
    assert.match(rendered, /Startups/);
    assert.match(rendered, /November 2026/);
    assert.doesNotMatch(card({ detailsRows: [] }), />Details</);

    const owner = card({ isOwner: true, onEditSection: () => {}, detailsRows: profileDetailsRows({ now, viewerTimeZone: 'UTC', createdAt: joined, timeZone: null, interests: [], experienceLevel: null, hoursPerWeek: null, isOwner: true, preferencesShownElsewhere: true }) });
    assert.match(owner, /Add interests/);
    assert.match(owner, /href="\/my-profile\/edit\?section=skills"/);
});

const rowsWith = (interests: string[], extra: Partial<Parameters<typeof profileDetailsRows>[0]> = {}) =>
    profileDetailsRows({ now, viewerTimeZone: 'UTC', createdAt: joined, timeZone: null, interests, experienceLevel: null, hoursPerWeek: null, isOwner: false, preferencesShownElsewhere: false, ...extra });
const visibleText = (markup: string) => markup.replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '');

test('Details interests read like Collaboration: plain comma list, no chips', () => {
    const rendered = card({ detailsRows: rowsWith(['Startups', 'Web3', 'DevOps']) });
    assert.doesNotMatch(rendered, /nb-tag/);
    assert.match(visibleText(rendered), /Startups,Web3,DevOps/);
    assert.match(rendered, /<ul aria-label="Interests"/);
});

test('Details interests: first 6, then a +N more button', () => {
    const many = ['Open Source', 'Startups', 'AI/ML', 'Web3', 'Gaming', 'Education', 'Healthcare', 'Fintech'];
    const rendered = card({ detailsRows: rowsWith(many) });
    for (const shown of many.slice(0, 6)) assert.match(rendered, new RegExp(shown.replace('/', '\\/')));
    assert.doesNotMatch(rendered, /Healthcare|Fintech/);
    assert.match(rendered, /<button[^>]*aria-expanded="false"[^>]*>\+2 more<\/button>/);
    assert.doesNotMatch(card({ detailsRows: rowsWith(many.slice(0, 6)) }), /more<\/button>/);
});

test('Details local time names the time zone on hover and for screen readers', () => {
    const rows = rowsWith([], { timeZone: 'Asia/Kolkata' });
    const local = rows.find((row) => row.key === 'localTime')!;
    assert.match(local.description ?? '', /Asia\/Kolkata/);
    const rendered = card({ detailsRows: rows });
    assert.match(rendered, /title="[^"]*Asia\/Kolkata"/);
    assert.match(rendered, /<span class="sr-only">[^<]*Asia\/Kolkata<\/span>/);
});

test('Details owner gets the edit pencil; visitors do not', () => {
    assert.match(card({ isOwner: true, onEditSection: () => {}, detailsRows: rowsWith(['Web3'], { isOwner: true }) }), /aria-label="Edit details"/);
    assert.doesNotMatch(card({ detailsRows: rowsWith(['Web3']) }), /Edit details/);
});

test('The right card draws Collaboration and Details with the one shared fact list', () => {
    const source = readFileSync('src/components/profile/v2/sections/ProfileFactsCard.tsx', 'utf8');
    assert.equal((source.match(/<FactList /g) ?? []).length, 2);
    assert.doesNotMatch(source, /<dl /, 'no second copy of the row markup');
    const rendered = card({ detailsRows: [], profile: { openToCollaborate: true, openTo: ['part_time'], preferredCategories: ['Quality Assurance'], experienceLevel: 'student', hoursPerWeek: 'h_5_10' } });
    assert.match(rendered, /Role types/);
    assert.match(rendered, /Quality Assurance/);
    assert.match(rendered, /title="5–10 hours a week"/);
});

test('Right card order by viewer: the owner starts with completeness; a visitor with Collaboration, then people you both know', () => {
    const source = readFileSync('src/components/profile/v2/sections/ProfileFactsCard.tsx', 'utf8');
    assert.match(source, /isOwner \? \[completeness, collaboration, organizations, details, linkSection\] : \[collaboration, mutual, organizations, details, linkSection\]/);
    const skeleton = readFileSync('src/components/profile/v2/ProfileRouteSkeleton.tsx', 'utf8');
    assert.ok(skeleton.indexOf('title="Collaboration preferences"') < skeleton.indexOf('title="Details"'));
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
