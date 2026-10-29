import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    PROJECT_NOTIFICATION_EVENT_KEYS,
    PROJECT_NOTIFICATION_EVENT_REGISTRY,
    buildCreateProjectNotificationPolicy,
    buildDefaultProjectNotificationPolicy,
} from '../../src/lib/notifications/project-policy';
import { createProjectSchema } from '../../src/lib/validations/project';
import { projectActionsSource } from "./_project-actions-source";

const read = (path: string) => readFileSync(path, 'utf8');

test('step 4 notification switches: on keeps defaults, off silences only that area, mandatory stays on', () => {
    const defaults = buildDefaultProjectNotificationPolicy('balanced');
    assert.deepEqual(buildCreateProjectNotificationPolicy(undefined), defaults);
    assert.deepEqual(buildCreateProjectNotificationPolicy({ roles_applications: true, work: true, updates_docs: true }), defaults);

    const policy = buildCreateProjectNotificationPolicy({ work: false });
    for (const key of PROJECT_NOTIFICATION_EVENT_KEYS) {
        const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[key];
        const inWork = ['tasks_workflow', 'project_lifecycle', 'files_workspace'].includes(entry.group);
        const expected = inWork && !entry.mandatory ? false : defaults.rules[key].enabled;
        assert.equal(policy.rules[key].enabled, expected, key);
        if (entry.mandatory) assert.equal(policy.rules[key].enabled, true, `${key} is mandatory`);
    }
});

test('launch settings parse with Workspace settings defaults when untouched', () => {
    const parsed = createProjectSchema.parse({
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
    assert.match(action, /publicTabVisibility: normalizeProjectPublicTabVisibility\(input\.public_tab_visibility\)/);
    assert.match(action, /memberUpdatesEnabled: input\.member_updates_enabled !== false/);
    assert.match(action, /memberFileUploadDefault: input\.member_file_upload_default !== false/);
    assert.match(action, /notificationPreferences: buildCreateProjectNotificationPolicy\(input\.notification_rows\)/);
    assert.match(action, /updateValues\.memberFileUploadDefault = raw\.memberFileUploadDefault/);

    const lifecycle = read('src/lib/projects/collaborator-lifecycle.ts');
    assert.match(lifecycle, /SELECT id, owner_id, title, slug, member_file_upload_default/);
    assert.match(lifecycle, /fileUploadEnabled: project\.memberFileUploadDefault/);

    assert.ok(existsSync('drizzle/0177_projects_member_file_upload_default.sql'));
    assert.match(read('drizzle/0177_projects_member_file_upload_default.sql'), /ADD COLUMN IF NOT EXISTS member_file_upload_default boolean DEFAULT true NOT NULL/);
    assert.match(read('src/lib/db/schema/index.ts'), /memberFileUploadDefault: boolean\("member_file_upload_default"\)/);

    const settings = read('src/components/projects/tabs/ProjectSettingsTab.tsx');
    assert.match(settings, /aria-label="New members can upload files"/);
    assert.match(settings, /updateProject\(projectId, \{ memberFileUploadDefault: enabled \}\)/);
});

test('step 4 shows the eight Workspace settings sections in order; picture and doc editing apply after create', () => {
    const phase = read('src/components/projects/create-wizard/phases/Phase4Settings.tsx');
    const order = ['picture', 'access', 'links', 'documentation', 'lifecycle', 'permissions', 'files', 'notifications'];
    const positions = order.map((id) => phase.indexOf(`{...sectionProps('${id}')}`));
    assert.ok(positions.every((position) => position > 0), 'every section is rendered');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'sections render in Settings order');
    assert.match(phase, /<SettingsSwitch /);
    assert.match(phase, /aria-label="Starting settings sections"/);
    assert.match(phase, /aria-expanded=\{open\}/);
    assert.match(phase, /useWatch\(\{/);

    const hook = read('src/components/projects/create-wizard/useCreateProjectWizard.ts');
    assert.match(hook, /await uploadProjectImage\(projectId, projectImage\)/);
    assert.match(hook, /updateProjectDocSettingsAction\(projectId, \{ editPolicy: 'members' \}\)/);
    assert.match(hook, /if \(createdProjectId\) await applyLaunchSettingsAfterCreate\(createdProjectId\);/);
});

test('step 4 retains its wizard rail while Project Settings uses the shared settings navigation', () => {
    const phase = read('src/components/projects/create-wizard/phases/Phase4Settings.tsx');
    const settings = read('src/components/projects/settings/ProjectSettingsNavigation.tsx');
    const wizard = read('src/components/projects/create-wizard/CreateProjectWizard.tsx');
    const settingsRow = 'group flex min-h-[44px] w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)]';

    // Project Settings now follows main Settings; the separate wizard keeps its existing rail.
    assert.match(settings, /nb-nav-link/);
    assert.ok(phase.includes(settingsRow));
    assert.match(phase, /rounded-lg border border-border bg-card p-2 xl:block/);
    assert.match(phase, /active \? 'bg-muted font-medium text-foreground'/);

    // Regression: scrollIntoView also scrolled the app's overflow-hidden main and hid the page header.
    assert.doesNotMatch(phase, /\.scrollIntoView\(/);
    assert.match(phase, /closest<HTMLElement>\('\[data-wizard-scroll\]'\)/);
    assert.match(phase, /scroller\.scrollTo\(\{/);
    assert.match(wizard, /data-wizard-scroll/);
});
