import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_MEMBER_ROLE_LABELS } from '../../src/lib/projects/settings-policies';
import { defaultOrgRoleNames, ORG_TYPES } from '../../src/lib/organizations/config';
import { formatContributionPosition } from '../../src/lib/profile/contribution-position';

const RETIRED = /^(?:Lead|Co-lead|Co-leader|Leader|Guest)$/;

// Decision 1 and 3: one ladder (Owner, Admin, Member, Viewer) on every label surface.
test('no label surface uses the retired role names', () => {
  for (const label of Object.values(PROJECT_MEMBER_ROLE_LABELS)) assert.doesNotMatch(label, RETIRED);
  for (const type of ORG_TYPES) for (const name of Object.values(defaultOrgRoleNames(type))) assert.doesNotMatch(name, RETIRED, `${type}: ${name}`);
});

// Report §15 #4: a contribution shows what someone did, never their access level.
test('contribution titles never show an access level', () => {
  assert.equal(formatContributionPosition({ title: 'Lead · Owner' }), 'Contributor');
  assert.equal(formatContributionPosition({ title: 'Admin', projectPosition: 'Product designer' }), 'Product designer');
});
