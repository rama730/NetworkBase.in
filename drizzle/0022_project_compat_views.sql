-- Old project names kept as views from the workspace rename. Temporary.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE VIEW public.profile_project_contribution_stages WITH (security_invoker='true') AS
 SELECT id,
    contribution_id,
    profile_id,
    workspace_id AS project_id,
    source,
    role_kind,
    role_title,
    summary,
    skills,
    started_at,
    ended_at,
    verified_at,
    verified_by,
    event_id,
    visibility,
    manual_override,
    display_order,
    created_at,
    updated_at,
    deleted_at
   FROM public.profile_contribution_stages;
--> statement-breakpoint
COMMENT ON VIEW public.profile_project_contribution_stages IS 'Old name of profile_contribution_stages (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.profile_project_contributions WITH (security_invoker='true') AS
 SELECT id,
    profile_id,
    workspace_id AS project_id,
    source,
    role_kind,
    role_title,
    summary,
    skills,
    started_at,
    ended_at,
    verified_at,
    verified_by,
    visibility,
    created_at,
    updated_at,
    deleted_at,
    external_key,
    project_title,
    project_url,
    repository_url,
    version,
    presentation,
    featured,
    published_at,
    verification_revoked_reason,
    show_work_record
   FROM public.profile_contributions;
--> statement-breakpoint
COMMENT ON VIEW public.profile_project_contributions IS 'Old name of profile_contributions (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_doc_versions WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    version_number,
    content,
    excerpt,
    headings,
    quality_report,
    content_hash,
    change_summary,
    created_by,
    created_at,
    deleted_at,
    co_authors,
    doc_id
   FROM public.workspace_document_versions;
--> statement-breakpoint
COMMENT ON VIEW public.project_doc_versions IS 'Old name of workspace_document_versions (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_docs WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    published_version_id,
    settings,
    created_at,
    updated_at,
    linked_node_id,
    filename,
    slug
   FROM public.workspace_documents;
--> statement-breakpoint
COMMENT ON VIEW public.project_docs IS 'Old name of workspace_documents (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_event_counters WITH (security_invoker='true') AS
 SELECT workspace_id AS project_id,
    next_sequence,
    updated_at
   FROM public.workspace_event_counters;
--> statement-breakpoint
COMMENT ON VIEW public.project_event_counters IS 'Old name of workspace_event_counters (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_file_index WITH (security_invoker='true') AS
 SELECT node_id,
    workspace_id AS project_id,
    content,
    updated_at
   FROM public.workspace_file_index;
--> statement-breakpoint
COMMENT ON VIEW public.project_file_index IS 'Old name of workspace_file_index (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_follows WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    user_id,
    created_at
   FROM public.workspace_follows;
--> statement-breakpoint
COMMENT ON VIEW public.project_follows IS 'Old name of workspace_follows (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_git_deltas WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    task_id,
    target_branch,
    sequence_number,
    delta_order,
    action,
    node_id,
    path,
    old_path,
    git_blob_hash,
    file_version_id,
    s3_key,
    status,
    job_id,
    processed_commit_sha,
    processing_error,
    processed_at,
    created_at
   FROM public.workspace_git_deltas;
--> statement-breakpoint
COMMENT ON VIEW public.project_git_deltas IS 'Old name of workspace_git_deltas (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_guidance_appointments WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    guide_user_id,
    invitation_id,
    label,
    status,
    review_at,
    public_attribution_consent,
    previous_membership_role,
    accepted_at,
    ended_at,
    ended_by,
    end_reason,
    created_at,
    updated_at
   FROM public.workspace_mentors;
--> statement-breakpoint
COMMENT ON VIEW public.project_guidance_appointments IS 'Old name of workspace_mentors (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_invitations WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    inviter_id,
    candidate_id,
    kind,
    role_id,
    role_title,
    guidance_label,
    note,
    project_title,
    status,
    expires_at,
    review_at,
    idempotency_key,
    resolved_at,
    resolved_by,
    created_at,
    updated_at
   FROM public.workspace_invitations;
--> statement-breakpoint
COMMENT ON VIEW public.project_invitations IS 'Old name of workspace_invitations (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_members WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    user_id,
    role,
    joined_at,
    file_upload_enabled,
    notification_preferences,
    title,
    show_on_profile,
    last_seen_updates_at,
    unit_id
   FROM public.workspace_members;
--> statement-breakpoint
COMMENT ON VIEW public.project_members IS 'Old name of workspace_members (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_node_conflicts WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    node_id,
    task_id,
    git_branch,
    canonical_content,
    incoming_content,
    merged_content,
    conflict_status,
    created_at
   FROM public.workspace_node_conflicts;
--> statement-breakpoint
COMMENT ON VIEW public.project_node_conflicts IS 'Old name of workspace_node_conflicts (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_node_events WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    node_id,
    actor_id,
    type,
    metadata,
    created_at,
    sequence_number
   FROM public.workspace_node_events;
--> statement-breakpoint
COMMENT ON VIEW public.project_node_events IS 'Old name of workspace_node_events (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_node_locks WITH (security_invoker='true') AS
 SELECT node_id,
    workspace_id AS project_id,
    locked_by,
    acquired_at,
    expires_at,
    session_id,
    lease_id,
    client_kind,
    device_session_id,
    fencing_token,
    renewed_at
   FROM public.workspace_node_locks;
--> statement-breakpoint
COMMENT ON VIEW public.project_node_locks IS 'Old name of workspace_node_locks (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_nodes WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    parent_id,
    type,
    name,
    s3_key,
    size,
    mime_type,
    metadata,
    created_by,
    created_at,
    updated_at,
    deleted_by,
    deleted_at,
    git_blob_hash,
    path,
    current_version,
    task_id,
    canonical_node_id,
    last_synced_commit_sha,
    sync_status,
    asset_id
   FROM public.workspace_nodes;
--> statement-breakpoint
COMMENT ON VIEW public.project_nodes IS 'Old name of workspace_nodes (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_open_roles WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    role,
    title,
    description,
    count,
    filled,
    created_at,
    updated_at,
    skills,
    commitment_type,
    experience_required,
    hours_per_week,
    team_lead_user_id AS lead_user_id
   FROM public.workspace_open_roles;
--> statement-breakpoint
COMMENT ON VIEW public.project_open_roles IS 'Old name of workspace_open_roles (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_skills WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    skill_id,
    created_at,
    usage_kind,
    display_order,
    evidence,
    updated_at
   FROM public.workspace_skills;
--> statement-breakpoint
COMMENT ON VIEW public.project_skills IS 'Old name of workspace_skills (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_sprint_events WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    sprint_id,
    actor_id,
    event_type,
    payload,
    created_at
   FROM public.workspace_sprint_events;
--> statement-breakpoint
COMMENT ON VIEW public.project_sprint_events IS 'Old name of workspace_sprint_events (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_sprints WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    name,
    goal,
    start_date,
    end_date,
    status,
    created_at,
    updated_at,
    description,
    creator_id,
    sprint_number,
    started_at,
    completed_at,
    archived_at,
    cancelled_at,
    parent_sprint_id,
    auto_start,
    show_in_children,
    notify_on_start
   FROM public.workspace_sprints;
--> statement-breakpoint
COMMENT ON VIEW public.project_sprints IS 'Old name of workspace_sprints (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_tags WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    tag_id,
    created_at
   FROM public.workspace_tags;
--> statement-breakpoint
COMMENT ON VIEW public.project_tags IS 'Old name of workspace_tags (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_task_policy_events WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    actor_id,
    review_required,
    policy_version,
    created_at
   FROM public.workspace_task_policy_events;
--> statement-breakpoint
COMMENT ON VIEW public.project_task_policy_events IS 'Old name of workspace_task_policy_events (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_update_comments WITH (security_invoker='true') AS
 SELECT id,
    update_id,
    workspace_id AS project_id,
    user_id,
    content,
    deleted_by,
    deleted_at,
    created_at,
    updated_at,
    parent_id,
    target_user_id
   FROM public.workspace_update_comments;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_comments IS 'Old name of workspace_update_comments (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_update_draft_media_assets WITH (security_invoker='true') AS
 SELECT workspace_id AS project_id,
    user_id,
    asset_id,
    ordinal,
    created_at
   FROM public.workspace_update_draft_media_assets;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_draft_media_assets IS 'Old name of workspace_update_draft_media_assets (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_update_drafts WITH (security_invoker='true') AS
 SELECT workspace_id AS project_id,
    user_id,
    content,
    visibility,
    update_type,
    entity_refs,
    media,
    updated_at
   FROM public.workspace_update_drafts;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_drafts IS 'Old name of workspace_update_drafts (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_update_likes WITH (security_invoker='true') AS
 SELECT id,
    update_id,
    user_id,
    created_at
   FROM public.workspace_update_likes;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_likes IS 'Old name of workspace_update_likes (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_update_media_assets WITH (security_invoker='true') AS
 SELECT id,
    update_id,
    asset_id,
    ordinal,
    created_at
   FROM public.workspace_update_media_assets;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_media_assets IS 'Old name of workspace_update_media_assets (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_updates WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    author_id,
    content,
    update_type,
    visibility,
    reply_policy,
    entity_refs,
    media,
    metadata,
    is_pinned,
    like_count,
    comment_count,
    deleted_by,
    edited_at,
    deleted_at,
    created_at,
    updated_at,
    audience,
    notify_level,
    pinned_until,
    shared_to_org_at
   FROM public.workspace_updates;
--> statement-breakpoint
COMMENT ON VIEW public.project_updates IS 'Old name of workspace_updates (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.project_workflow_columns WITH (security_invoker='true') AS
 SELECT id,
    workspace_id AS project_id,
    status,
    title,
    accent_class_name,
    empty_title,
    empty_description,
    "position",
    is_default,
    created_at,
    updated_at
   FROM public.workspace_workflow_columns;
--> statement-breakpoint
COMMENT ON VIEW public.project_workflow_columns IS 'Old name of workspace_workflow_columns (0264). Drop after one release.';
--> statement-breakpoint
CREATE VIEW public.projects WITH (security_invoker='true') AS
 SELECT id,
    owner_id,
    title,
    description,
    short_description,
    cover_image,
    category,
    tags,
    skills,
    visibility,
    status,
    looking_for_collaborators,
    max_collaborators,
    created_at,
    updated_at,
    slug,
    view_count,
    problem_statement,
    solution_statement,
    lifecycle_stages,
    current_stage_index,
    key,
    current_task_number,
    import_source,
    sync_status,
    followers_count,
    saves_count,
    github_repo_url,
    github_default_branch,
    github_last_sync_at,
    github_last_commit_sha,
    deleted_at,
    cover_image_bucket,
    cover_image_key,
    public_tab_visibility,
    notification_preferences,
    stage_completion_dates,
    current_sequence_number,
    member_updates_enabled,
    open_roles_count,
    external_links,
    external_link_metadata,
    member_file_upload_default,
    cover_image_asset_id,
    status_text,
    status_expires_at,
    status_set_by,
    status_set_at,
    status_emoji,
    task_review_required,
    task_completion_policy_version,
    kind,
    parent_id,
    org_type,
    org_settings,
    term_start,
    term_end,
    time_zone,
    welcome_note,
    join_code,
    join_code_enabled,
    verified_at,
    verified_by,
    verification_domain,
    suspended_at,
    suspend_reason,
    deletion_scheduled_at,
    discover_hidden_at,
    verification_requested_at
   FROM public.workspaces;
--> statement-breakpoint
COMMENT ON VIEW public.projects IS 'Old name of workspaces (0264). Drop after one release.';
--> statement-breakpoint
GRANT ALL ON TABLE public.profile_project_contribution_stages TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_project_contribution_stages TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.profile_project_contributions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_project_contributions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_doc_versions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_doc_versions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_docs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_docs TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_event_counters TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_event_counters TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_file_index TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_file_index TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_follows TO service_role;
GRANT SELECT ON TABLE public.project_follows TO anon;
GRANT SELECT ON TABLE public.project_follows TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_follows TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_git_deltas TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_git_deltas TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_guidance_appointments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_guidance_appointments TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_invitations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_invitations TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_members TO service_role;
GRANT SELECT ON TABLE public.project_members TO anon;
GRANT SELECT ON TABLE public.project_members TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_members TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_node_conflicts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_node_conflicts TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_node_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_node_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_node_locks TO service_role;
GRANT SELECT ON TABLE public.project_node_locks TO anon;
GRANT SELECT ON TABLE public.project_node_locks TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_node_locks TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_nodes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_nodes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_open_roles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_open_roles TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_skills TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_sprint_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_sprint_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_sprints TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_sprints TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_tags TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_tags TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_task_policy_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_task_policy_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_update_comments TO service_role;
GRANT SELECT ON TABLE public.project_update_comments TO anon;
GRANT SELECT ON TABLE public.project_update_comments TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_update_comments TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_update_draft_media_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_update_draft_media_assets TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_update_drafts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_update_drafts TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_update_likes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_update_likes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_update_media_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_update_media_assets TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_updates TO service_role;
GRANT SELECT ON TABLE public.project_updates TO anon;
GRANT SELECT ON TABLE public.project_updates TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_updates TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.project_workflow_columns TO service_role;
GRANT SELECT ON TABLE public.project_workflow_columns TO anon;
GRANT SELECT ON TABLE public.project_workflow_columns TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_workflow_columns TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.projects TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.projects TO nb_app;
--> statement-breakpoint
GRANT SELECT(id) ON TABLE public.projects TO anon;
GRANT SELECT(id) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(owner_id) ON TABLE public.projects TO anon;
GRANT SELECT(owner_id) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(title) ON TABLE public.projects TO anon;
GRANT SELECT(title) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(description) ON TABLE public.projects TO anon;
GRANT SELECT(description) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(short_description) ON TABLE public.projects TO anon;
GRANT SELECT(short_description) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image) ON TABLE public.projects TO anon;
GRANT SELECT(cover_image) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(category) ON TABLE public.projects TO anon;
GRANT SELECT(category) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(tags) ON TABLE public.projects TO anon;
GRANT SELECT(tags) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(skills) ON TABLE public.projects TO anon;
GRANT SELECT(skills) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(visibility) ON TABLE public.projects TO anon;
GRANT SELECT(visibility) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(status) ON TABLE public.projects TO anon;
GRANT SELECT(status) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(looking_for_collaborators) ON TABLE public.projects TO anon;
GRANT SELECT(looking_for_collaborators) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(max_collaborators) ON TABLE public.projects TO anon;
GRANT SELECT(max_collaborators) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(created_at) ON TABLE public.projects TO anon;
GRANT SELECT(created_at) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(updated_at) ON TABLE public.projects TO anon;
GRANT SELECT(updated_at) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(slug) ON TABLE public.projects TO anon;
GRANT SELECT(slug) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(view_count) ON TABLE public.projects TO anon;
GRANT SELECT(view_count) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(problem_statement) ON TABLE public.projects TO anon;
GRANT SELECT(problem_statement) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(solution_statement) ON TABLE public.projects TO anon;
GRANT SELECT(solution_statement) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(lifecycle_stages) ON TABLE public.projects TO anon;
GRANT SELECT(lifecycle_stages) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(current_stage_index) ON TABLE public.projects TO anon;
GRANT SELECT(current_stage_index) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(key) ON TABLE public.projects TO anon;
GRANT SELECT(key) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(current_task_number) ON TABLE public.projects TO anon;
GRANT SELECT(current_task_number) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(sync_status) ON TABLE public.projects TO anon;
GRANT SELECT(sync_status) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(followers_count) ON TABLE public.projects TO anon;
GRANT SELECT(followers_count) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(saves_count) ON TABLE public.projects TO anon;
GRANT SELECT(saves_count) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_repo_url) ON TABLE public.projects TO anon;
GRANT SELECT(github_repo_url) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_default_branch) ON TABLE public.projects TO anon;
GRANT SELECT(github_default_branch) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_last_sync_at) ON TABLE public.projects TO anon;
GRANT SELECT(github_last_sync_at) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_last_commit_sha) ON TABLE public.projects TO anon;
GRANT SELECT(github_last_commit_sha) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(deleted_at) ON TABLE public.projects TO anon;
GRANT SELECT(deleted_at) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image_bucket) ON TABLE public.projects TO anon;
GRANT SELECT(cover_image_bucket) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image_key) ON TABLE public.projects TO anon;
GRANT SELECT(cover_image_key) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(public_tab_visibility) ON TABLE public.projects TO anon;
GRANT SELECT(public_tab_visibility) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(notification_preferences) ON TABLE public.projects TO anon;
GRANT SELECT(notification_preferences) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(stage_completion_dates) ON TABLE public.projects TO anon;
GRANT SELECT(stage_completion_dates) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(current_sequence_number) ON TABLE public.projects TO anon;
GRANT SELECT(current_sequence_number) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(member_updates_enabled) ON TABLE public.projects TO anon;
GRANT SELECT(member_updates_enabled) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(open_roles_count) ON TABLE public.projects TO anon;
GRANT SELECT(open_roles_count) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(external_links) ON TABLE public.projects TO anon;
GRANT SELECT(external_links) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(external_link_metadata) ON TABLE public.projects TO anon;
GRANT SELECT(external_link_metadata) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(member_file_upload_default) ON TABLE public.projects TO anon;
GRANT SELECT(member_file_upload_default) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image_asset_id) ON TABLE public.projects TO anon;
GRANT SELECT(cover_image_asset_id) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_text) ON TABLE public.projects TO anon;
GRANT SELECT(status_text) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_expires_at) ON TABLE public.projects TO anon;
GRANT SELECT(status_expires_at) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_set_by) ON TABLE public.projects TO anon;
GRANT SELECT(status_set_by) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_set_at) ON TABLE public.projects TO anon;
GRANT SELECT(status_set_at) ON TABLE public.projects TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_emoji) ON TABLE public.projects TO anon;
GRANT SELECT(status_emoji) ON TABLE public.projects TO authenticated;
