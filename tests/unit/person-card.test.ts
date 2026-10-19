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

test('connections show month and year, while invitations retain day, month and year at all widths', () => {
    const value = '2026-05-14T23:00:00Z';
    assert.equal(personConnectedDate(value).text, 'Connected · May 2026');
    assert.deepEqual(personRequestDate(value), {
        text: 'Requested · 14 May 2026',
        compactText: '14 May 2026',
        title: 'Thu, 14 May 2026 23:00:00 GMT',
    });
    assert.equal(personRequestDate(new Date(value))?.text, personRequestDate(value)?.text);
    assert.equal(personRequestDate('2026-01-01T00:30:00+02:00')?.compactText, '31 Dec 2025');
    assert.equal(personConnectedDate('2026-01-01T00:30:00+02:00').text, 'Connected · Dec 2025');
    assert.equal(personRequestDate(null), null);
    assert.equal(personRequestDate('invalid'), null);
});

test('legacy connections show the request month honestly when acceptance time is unknown', () => {
    const requestedAt = '2025-12-31T23:30:00Z';
    assert.deepEqual(personConnectedDate(null, requestedAt), {
        text: 'Request sent · Dec 2025',
        compactText: 'Requested · Dec 2025',
        title: 'Connection request sent on Wed, 31 Dec 2025 23:30:00 GMT; acceptance date unavailable',
    });
    assert.equal(personConnectedDate('invalid', new Date(requestedAt)).text, 'Request sent · Dec 2025');
    assert.equal(personConnectedDate('2026-01-04T00:00:00Z', requestedAt).text, 'Connected · Jan 2026');
    assert.equal(personConnectedDate(null, 'invalid').text, 'Connected');
    assert.equal(personConnectedDate(null, null).text, 'Connected');
});

test('declared skills are canonical and unique before fitting, and historical dates are not fabricated', () => {
    assert.deepEqual(personCardSkills(['React', ' React ', '', 'TypeScript', 'react']), ['React', 'TypeScript']);
    assert.equal(personConnectedDate('unverified').text, 'Connected');
    assert.equal(personConnectedDate(null).text, 'Connected');
    assert.equal(personConnectedDate('2026-05-14T23:00:00Z').text, 'Connected · May 2026');
    assert.equal(personSharedCount(null), null);
    assert.equal(personSharedCount(0), null);
    assert.equal(personSharedCount(-1), null);
    assert.equal(personSharedCount(Number.NaN), null);
    assert.equal(personSharedCount(12_480), 12_480);
});
