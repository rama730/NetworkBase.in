import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    experienceLevelLabel,
    getRolePreferences,
    rolePreferenceLabel,
    WEEKLY_CAPACITY_OPTIONS,
} from '../../src/lib/profile/role-preferences';

const read = (path: string) => readFileSync(path, 'utf8');

test('profile header uses OpenToCollaborateBadge with brand square without duplicate hover popover', () => {
    const header = read('src/components/profile/v2/ProfileHeader.tsx');
    const badge = read('src/components/profile/OpenToCollaborateBadge.tsx');
    const css = read('src/app/globals.css');

    // ProfileHeader renders OpenToCollaborateBadge instead of round-circle nb-status
    assert.match(header, /<OpenToCollaborateBadge/);
    assert.doesNotMatch(header, /<span className="size-1\.5 rounded-full bg-current"/);

    // Profile page suppresses redundant hover popover because Role Preferences card is already visible on the page
    assert.match(badge, /isInteractive\s*=\s*interactive\s*!==\s*undefined\s*\?\s*interactive\s*:\s*variant\s*!==\s*'profile-header'/);

    // CSS defines brand square with 1px border-radius
    assert.match(css, /\.nb-person-collaboration::before\s*\{[^}]*width:\s*4px;\s*height:\s*4px;\s*border-radius:\s*1px;/);
    assert.match(css, /\.nb-person-collaboration\[data-variant="profile-header"\]::before[^{]*\{[^}]*width:\s*4\.5px;\s*height:\s*4\.5px;\s*border-radius:\s*1px;/);

    // Popover contains collaboration preferences structure for cards
    assert.match(badge, /Collaboration preferences/);
    assert.match(badge, /Popover\.Root/);
    assert.match(badge, /Popover\.Trigger/);
    assert.match(badge, /Popover\.Content/);
    assert.match(badge, /Role types/);
    assert.match(badge, /Preferred roles/);
    assert.match(badge, /Categories/);
    assert.match(badge, /Experience/);
    assert.match(badge, /Weekly availability/);
});

test('collaboration preference mappings resolve canonical values correctly', () => {
    const roles = getRolePreferences(['freelance', 'co-founder', 'full_time']);
    assert.deepEqual(roles, ['Full-time roles', 'Freelance projects', 'Co-founder opportunities']);

    const labels = roles.map((r) => rolePreferenceLabel(r));
    assert.deepEqual(labels, ['Full-time', 'Freelance', 'Co-founder']);

    assert.equal(experienceLevelLabel('mid'), 'Mid-level');
    assert.equal(experienceLevelLabel('senior'), 'Senior');

    const capacity = WEEKLY_CAPACITY_OPTIONS.find((o) => o.value === 'h_10_20');
    assert.equal(capacity?.compactLabel, '10–20 h/week');
});
