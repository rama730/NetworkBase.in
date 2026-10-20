import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personCardName, personCardSkills, personCardSubtitle, personConnectedDate, personRequestDate, personSharedCount, personPortfolioText } from '../../src/lib/network/person-card';

test('person cards use truthful, nonduplicated fallbacks and never infer collaboration from roles', () => {
    assert.equal(personCardName({ fullName: '  ', username: null }), 'NetworkBase member');
    const portfolio = { total: 1, projects: [{ id: 'p', title: 'Ponytail', slug: 'ponytail' }] };
    assert.deepEqual(personCardSubtitle({ headline: '  Engineer  ', portfolio, location: 'Lisbon' }), { kind: 'headline', text: 'Engineer' });
    assert.deepEqual(personCardSubtitle({ headline: ' ', portfolio, location: 'Lisbon' }), { kind: 'portfolio', text: 'Public portfolio · Ponytail' });
    assert.deepEqual(personCardSubtitle({ location: 'Lisbon' }), { kind: 'location', text: 'Lisbon' });
    assert.deepEqual(personCardSubtitle({ username: 'mira' }), { kind: 'username', text: '@mira' });
    assert.deepEqual(personCardSubtitle({ isLockedProfile: true, headline: 'Hidden', portfolio }), { kind: 'private', text: 'Private profile' });
    assert.equal(personPortfolioText({ total: 1, projects: [{ id: 'p', title: ' ', slug: null }] }), '1 public project');
    assert.equal(personPortfolioText({ total: 0, projects: [] }), null);
});

test('connections use acceptance dates and invitation ages are relative at every width', () => {
    const value = '2026-10-19T10:20:54Z';
    const now = Date.parse('2026-10-20T11:00:00Z');
    assert.equal(personConnectedDate(value).text, 'Connected since Oct 2026');
    assert.deepEqual(personRequestDate(value, now), {
        text: 'Requested · 1 day ago', compactText: '1 day ago',
        title: 'Mon, 19 Oct 2026 10:20:54 GMT',
    });
    assert.equal(personRequestDate(new Date(value), now)?.text, personRequestDate(value, now)?.text);
    assert.equal(personRequestDate('2026-10-20T10:00:00Z', now)?.compactText, '1 hour ago');
    assert.equal(personRequestDate('2026-10-20T10:59:00Z', now)?.compactText, '1 minute ago');
    assert.equal(personRequestDate('2026-10-20T10:59:59Z', now)?.compactText, 'Just now');
    assert.equal(personRequestDate('2026-10-19T12:20:54+02:00', now)?.compactText, '1 day ago');
    assert.equal(personRequestDate('2026-10-21T10:00:00Z', now)?.compactText, '21 Oct 2026');
    assert.equal(personRequestDate(null, now), null);
    assert.equal(personRequestDate('invalid', now), null);
    assert.equal(personConnectedDate('2026-01-01T00:30:00+02:00').text, 'Connected since Dec 2025');
});

test('legacy connections never substitute their request date for an unknown acceptance date', () => {
    assert.deepEqual(personConnectedDate(null), {
        text: 'Connected', compactText: 'Connected', title: 'Connected; acceptance date unavailable',
    });
    assert.equal(personConnectedDate('invalid').text, 'Connected');
    assert.equal(personConnectedDate('2026-01-04T00:00:00Z').text, 'Connected since Jan 2026');
});

test('declared skills are canonical and unique before fitting, and historical dates are not fabricated', () => {
    assert.deepEqual(personCardSkills(['React', ' React ', '', 'TypeScript', 'react']), ['React', 'TypeScript']);
    assert.equal(personConnectedDate('unverified').text, 'Connected');
    assert.equal(personConnectedDate(null).text, 'Connected');
    assert.equal(personConnectedDate('2026-05-14T23:00:00Z').text, 'Connected since May 2026');
    assert.equal(personSharedCount(null), null);
    assert.equal(personSharedCount(0), null);
    assert.equal(personSharedCount(-1), null);
    assert.equal(personSharedCount(Number.NaN), null);
    assert.equal(personSharedCount(12_480), 12_480);
});
