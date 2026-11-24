import type { CreateLocation } from '@/components/organizations/CreateLocation';
import { capChildVisibility, type VisibilityCap } from '@/lib/organizations/child-rules';
import { orgTypeDefaults } from '@/lib/organizations/creation';
import { DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY, type WorkspacePublicTabId } from '@/lib/workspaces/settings-policies';
import { getLifecycleStagesForWorkspaceType } from '@/lib/workspaces/lifecycle-templates';
import { socialLinkItemsFromStorage } from '@/lib/profile/normalization';
import type { CreateWorkspaceInput } from '@/lib/validations/workspace';

/** Settings step sections (create wizard v6), in Project settings order; an organization leads with its own two. */
export type SettingsSectionId = 'calendar' | 'inside' | 'picture' | 'access' | 'links' | 'documentation' | 'lifecycle' | 'permissions' | 'files' | 'notifications';
export const WORKSPACE_SETTINGS_SECTIONS: SettingsSectionId[] = ['picture', 'access', 'links', 'documentation', 'lifecycle', 'permissions', 'files', 'notifications'];
export const ORG_SETTINGS_SECTIONS: SettingsSectionId[] = ['calendar', 'inside', 'picture', 'access', 'links', 'documentation', 'permissions', 'files', 'notifications'];

const PUBLIC_TABS: WorkspacePublicTabId[] = ['dashboard', 'readme', 'updates', 'files', 'sprints', 'tasks'];
const NOTIFICATIONS = { roles_applications: true, work: true, updates_docs: true };

/** Where each setting starts: the org's cap and defaults, the type's, the category's stages. */
export function settingsDefaults(values: CreateWorkspaceInput, childOrg: CreateLocation | null | undefined) {
    const orgDefaults = values.organization ? orgTypeDefaults(values.organization.org_type ?? 'other') : null;
    return {
        visibility: (orgDefaults?.visibility ?? (childOrg ? capChildVisibility('org', childOrg.visibilityCap as VisibilityCap, childOrg.orgPublic) : 'public')) as NonNullable<CreateWorkspaceInput['visibility']>,
        memberUpdates: orgDefaults?.memberUpdates ?? childOrg?.memberUpdatesEnabled ?? true,
        memberUploads: childOrg?.memberFileUploadDefault ?? true,
        followSprints: Boolean(childOrg?.followSprintsDefault),
        stages: values.project_type ? getLifecycleStagesForWorkspaceType(values.project_type) : [],
        notifications: NOTIFICATIONS,
    };
}

/** Which sections differ from where they start (Settings' Changed tags, Reset all, and Review's "n of m changed"). An
 *  organization's Calendar and Workspaces inside have no single default, so they never count as changed. */
export function settingsChanges(values: CreateWorkspaceInput, ctx: { childOrg?: CreateLocation | null; hasPicture: boolean }): Record<SettingsSectionId, boolean> {
    const d = settingsDefaults(values, ctx.childOrg);
    const tabs = { ...DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY, ...(values.public_tab_visibility || {}) };
    const rows = { ...NOTIFICATIONS, ...(values.notification_rows || {}) };
    const stages = values.lifecycle_stages || [];
    return {
        calendar: false,
        inside: false,
        picture: ctx.hasPicture,
        access: (values.visibility || 'public') !== d.visibility || PUBLIC_TABS.some((tab) => tabs[tab] !== DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY[tab]),
        links: socialLinkItemsFromStorage(values.external_links).length > 0,
        documentation: values.readme?.mode === 'skip' || Boolean(values.readme?.publishOnCreate) || values.doc_edit_policy === 'members' || Boolean(values.readme?.orgTemplateDocId),
        lifecycle: Boolean(values.project_type) && stages.join('\u0000') !== d.stages.join('\u0000'),
        permissions: (values.member_updates_enabled !== false) !== d.memberUpdates || (values.member_file_upload_default !== false) !== d.memberUploads
            || (Boolean(ctx.childOrg) && Boolean(values.follow_org_sprints) !== d.followSprints),
        files: Boolean(values.org_template_folder_id),
        notifications: Object.values(rows).some((on) => !on),
    };
}
