import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    WORKSPACE_NOTIFICATION_EVENT_KEYS,
    WORKSPACE_NOTIFICATION_EVENT_REGISTRY,
    buildCreateWorkspaceNotificationPolicy,
    buildDefaultWorkspaceNotificationPolicy,
} from '../../src/lib/notifications/workspace-policy';
import { createWorkspaceSchema } from '../../src/lib/validations/workspace';
import { projectActionsSource } from "./_workspace-actions-source";

const read = (path: string) => readFileSync(path, 'utf8');

test('step 4 notification switches: on keeps defaults, off silences only that area, mandatory stays on', () => {
    const defaults = buildDefaultWorkspaceNotificationPolicy('balanced');
    assert.deepEqual(buildCreateWorkspaceNotificationPolicy(undefined), defaults);
    assert.deepEqual(buildCreateWorkspaceNotificationPolicy({ roles_applications: true, work: true, updates_docs: true }), defaults);

    const policy = buildCreateWorkspaceNotificationPolicy({ work: false });
    for (const key of WORKSPACE_NOTIFICATION_EVENT_KEYS) {
        const entry = WORKSPACE_NOTIFICATION_EVENT_REGISTRY[key];
        const inWork = ['tasks_workflow', 'project_lifecycle', 'files_workspace'].includes(entry.group);
        const expected = inWork && !entry.mandatory ? false : defaults.rules[key].enabled;
        assert.equal(policy.rules[key].enabled, expected, key);
        if (entry.mandatory) assert.equal(policy.rules[key].enabled, true, `${key} is mandatory`);
    }
});

test('launch settings parse with Workspace settings defaults when untouched', () => {
    const parsed = createWorkspaceSchema.parse({
        title: 'Launch-ready project',
        description: 'A sufficiently detailed description for project creation validation.',
        project_type: 'web_app',
    });
    assert.equal(parsed.member_updates_enabled, true);
    assert.equal(parsed.member_file_upload_default, true);
    assert.equal(parsed.doc_edit_policy, 'leaders');
    assert.equal('notification_preferences' in parsed, false);
});

test('create saves every step 4 setting; new members inherit the upload default', () => {
    const action = projectActionsSource();
    assert.match(action, /publicTabVisibility: normalizeWorkspacePublicTabVisibility\(input\.public_tab_visibility\)/);
    assert.match(action, /memberUpdatesEnabled: input\.member_updates_enabled !== false/);
    assert.match(action, /memberFileUploadDefault: input\.member_file_upload_default !== false/);
    assert.match(action, /notificationPreferences: buildCreateWorkspaceNotificationPolicy\(input\.notification_rows\)/);
    assert.match(action, /updateValues\.memberFileUploadDefault = raw\.memberFileUploadDefault/);

    const lifecycle = read('src/lib/workspaces/collaborator-lifecycle.ts');
    assert.match(lifecycle, /SELECT id, owner_id, title, slug, member_file_upload_default/);
    assert.match(lifecycle, /fileUploadEnabled: project\.memberFileUploadDefault/);

    assert.match(read('drizzle/0006_workspaces_members.sql'), /member_file_upload_default boolean DEFAULT true NOT NULL/);
    assert.match(read('src/lib/db/schema/index.ts'), /memberFileUploadDefault: boolean\("member_file_upload_default"\)/);

    const settings = read('src/components/workspaces/tabs/WorkspaceSettingsTab.tsx');
    assert.match(settings, /aria-label="New members can upload files"/);
    assert.match(settings, /updateWorkspace\(projectId, \{ memberFileUploadDefault: enabled \}\)/);
});

test('step 4 shows the eight Workspace settings sections in order; picture and doc editing apply after create', () => {
    const phase = read('src/components/workspaces/create-wizard/phases/Phase4Settings.tsx');
    const order = ['picture', 'access', 'links', 'documentation', 'lifecycle', 'permissions', 'files', 'notifications'];
    const positions = order.map((id) => phase.indexOf(`{...sectionProps('${id}')}`));
    assert.ok(positions.every((position) => position > 0), 'every section is rendered');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'sections render in Settings order');
    assert.match(phase, /<SettingsSwitch /);
    assert.match(phase, /aria-label="Starting settings sections"/);
    assert.match(phase, /useWatch\(\{/);

    const hook = read('src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts');
    assert.match(hook, /await uploadWorkspaceImage\(projectId, projectImage\)/);
    assert.match(hook, /updateWorkspaceDocSettingsAction\(projectId, \{ editPolicy: 'members' \}\)/);
    // v6: picture, template folder and doc editing ride along with the make step.
    assert.match(hook, /await applyLaunchSettingsAfterCreate\(result\.project\.id\);/);
});

test('step 4 docks its section list like main Settings (v6.3) while Project Settings uses the shared navigation', () => {
    const phase = read('src/components/workspaces/create-wizard/phases/Phase4Settings.tsx');
    const settings = read('src/components/workspaces/settings/WorkspaceSettingsNavigation.tsx');
    const wizard = read('src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx');

    assert.match(settings, /nb-nav-link/);
    assert.match(phase, /data-settings-dock className="nbs-nav nb-sdock"/);
    assert.match(phase, /className="nbs-find"/);
    assert.match(phase, /className="nbs-nl"/);
    assert.match(phase, /data-nav-highlight/);
    assert.match(phase, /of \{pad\(sections\.length\)\} changed/);
    assert.match(phase, /Reset all/);

    // Regression: scrollIntoView also scrolled the app's overflow-hidden main and hid the page header.
    assert.doesNotMatch(phase, /\.scrollIntoView\(/);
    assert.match(phase, /closest<HTMLElement>\('\[data-wizard-scroll\]'\)/);
    assert.match(phase, /scroller\.scrollTo\(\{/);
    assert.match(wizard, /data-wizard-scroll/);
});
