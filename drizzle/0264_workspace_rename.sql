-- 0264: projects become workspaces (terminology report §12.3–12.4, decision 4).
-- One migration: tables, columns, the status enum, index/constraint/policy/trigger/function names, and every
-- function body that named a renamed table or column. Old table names stay as security_invoker views with the
-- old column names for one release; a later migration drops them. Stored values and storage keys are unchanged.
ALTER TABLE public.projects RENAME TO workspaces;
--> statement-breakpoint
ALTER TABLE public.project_members RENAME TO workspace_members;
--> statement-breakpoint
ALTER TABLE public.project_invitations RENAME TO workspace_invitations;
--> statement-breakpoint
ALTER TABLE public.project_guidance_appointments RENAME TO workspace_mentors;
--> statement-breakpoint
ALTER TABLE public.project_open_roles RENAME TO workspace_open_roles;
--> statement-breakpoint
ALTER TABLE public.project_follows RENAME TO workspace_follows;
--> statement-breakpoint
ALTER TABLE public.project_skills RENAME TO workspace_skills;
--> statement-breakpoint
ALTER TABLE public.project_tags RENAME TO workspace_tags;
--> statement-breakpoint
ALTER TABLE public.project_docs RENAME TO workspace_documents;
--> statement-breakpoint
ALTER TABLE public.project_doc_versions RENAME TO workspace_document_versions;
--> statement-breakpoint
ALTER TABLE public.project_updates RENAME TO workspace_updates;
--> statement-breakpoint
ALTER TABLE public.project_update_comments RENAME TO workspace_update_comments;
--> statement-breakpoint
ALTER TABLE public.project_update_likes RENAME TO workspace_update_likes;
--> statement-breakpoint
ALTER TABLE public.project_update_media_assets RENAME TO workspace_update_media_assets;
--> statement-breakpoint
ALTER TABLE public.project_update_drafts RENAME TO workspace_update_drafts;
--> statement-breakpoint
ALTER TABLE public.project_update_draft_media_assets RENAME TO workspace_update_draft_media_assets;
--> statement-breakpoint
ALTER TABLE public.project_sprints RENAME TO workspace_sprints;
--> statement-breakpoint
ALTER TABLE public.project_sprint_events RENAME TO workspace_sprint_events;
--> statement-breakpoint
ALTER TABLE public.project_workflow_columns RENAME TO workspace_workflow_columns;
--> statement-breakpoint
ALTER TABLE public.project_task_policy_events RENAME TO workspace_task_policy_events;
--> statement-breakpoint
ALTER TABLE public.project_nodes RENAME TO workspace_nodes;
--> statement-breakpoint
ALTER TABLE public.project_node_events RENAME TO workspace_node_events;
--> statement-breakpoint
ALTER TABLE public.project_node_locks RENAME TO workspace_node_locks;
--> statement-breakpoint
ALTER TABLE public.project_node_conflicts RENAME TO workspace_node_conflicts;
--> statement-breakpoint
ALTER TABLE public.project_file_index RENAME TO workspace_file_index;
--> statement-breakpoint
ALTER TABLE public.project_git_deltas RENAME TO workspace_git_deltas;
--> statement-breakpoint
ALTER TABLE public.project_event_counters RENAME TO workspace_event_counters;
--> statement-breakpoint
ALTER TABLE public.profile_project_contributions RENAME TO profile_contributions;
--> statement-breakpoint
ALTER TABLE public.profile_project_contribution_stages RENAME TO profile_contribution_stages;
--> statement-breakpoint
ALTER TABLE public.chat_channels RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.content_reports RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.email_outbox RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.extension_recovery_drafts RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.github_sync_connections RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.github_sync_files RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.github_sync_runs RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.import_jobs RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.org_email_invites RENAME COLUMN child_project_id TO child_workspace_id;
--> statement-breakpoint
ALTER TABLE public.profile_collaboration_summaries RENAME COLUMN project_count TO workspace_count;
--> statement-breakpoint
ALTER TABLE public.profile_collaboration_summaries RENAME COLUMN visible_project_count TO visible_workspace_count;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.profiles RENAME COLUMN projects_count TO workspaces_count;
--> statement-breakpoint
ALTER TABLE public.profiles RENAME COLUMN workspace_due_today_count TO my_work_due_today_count;
--> statement-breakpoint
ALTER TABLE public.profiles RENAME COLUMN workspace_in_progress_count TO my_work_in_progress_count;
--> statement-breakpoint
ALTER TABLE public.profiles RENAME COLUMN workspace_inbox_count TO my_work_inbox_count;
--> statement-breakpoint
ALTER TABLE public.profiles RENAME COLUMN workspace_layout TO files_layout;
--> statement-breakpoint
ALTER TABLE public.profiles RENAME COLUMN workspace_overdue_count TO my_work_overdue_count;
--> statement-breakpoint
ALTER TABLE public.workspace_document_versions RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_documents RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_event_counters RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_file_index RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_follows RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_members RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_node_conflicts RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_node_events RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME COLUMN lead_user_id TO team_lead_user_id;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_skills RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_sprint_events RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_tags RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_task_policy_events RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_update_draft_media_assets RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_update_drafts RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.workspace_workflow_columns RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.role_applications RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.sprint_task_memberships RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.storage_assets RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.storage_legacy_cleanup_targets RENAME COLUMN source_project_id TO source_workspace_id;
--> statement-breakpoint
ALTER TABLE public.task_activity_events RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.task_pushes RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.tasks RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TABLE public.upload_intents RENAME COLUMN project_id TO workspace_id;
--> statement-breakpoint
ALTER TYPE public.status_project RENAME TO status_workspace;
--> statement-breakpoint
ALTER TABLE public.chat_channels RENAME CONSTRAINT chat_channels_project_id_fkey TO chat_channels_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.content_reports RENAME CONSTRAINT content_reports_project_id_fkey TO content_reports_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.extension_recovery_drafts RENAME CONSTRAINT extension_recovery_drafts_project_id_fkey TO extension_recovery_drafts_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.file_versions RENAME CONSTRAINT file_versions_node_id_project_nodes_id_fk TO file_versions_node_id_workspace_nodes_id_fk;
--> statement-breakpoint
ALTER TABLE public.github_sync_connections RENAME CONSTRAINT github_sync_connections_project_id_fkey TO github_sync_connections_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.github_sync_files RENAME CONSTRAINT github_sync_files_project_id_fkey TO github_sync_files_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.github_sync_runs RENAME CONSTRAINT github_sync_runs_project_id_fkey TO github_sync_runs_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.import_jobs RENAME CONSTRAINT import_jobs_project_id_fkey TO import_jobs_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.org_email_invites RENAME CONSTRAINT org_email_invites_child_project_id_fkey TO org_email_invites_child_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_contribution_id_fkey TO profile_contribution_stages_contribution_id_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_pkey TO profile_contribution_stages_pkey;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_profile_id_fkey TO profile_contribution_stages_profile_id_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_project_id_fkey TO profile_contribution_stages_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_role_kind_check TO profile_contribution_stages_role_kind_check;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_source_check TO profile_contribution_stages_source_check;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_verified_by_fkey TO profile_contribution_stages_verified_by_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages RENAME CONSTRAINT profile_project_contribution_stages_visibility_check TO profile_contribution_stages_visibility_check;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_authority_shape_check TO profile_contributions_authority_shape_check;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_pkey TO profile_contributions_pkey;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_profile_id_fkey TO profile_contributions_profile_id_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_project_id_fkey TO profile_contributions_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_revoked_reason_length TO profile_contributions_revoked_reason_length;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_role_kind_check TO profile_contributions_role_kind_check;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_source_check TO profile_contributions_source_check;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_verified_by_fkey TO profile_contributions_verified_by_fkey;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_version_check TO profile_contributions_version_check;
--> statement-breakpoint
ALTER TABLE public.profile_contributions RENAME CONSTRAINT profile_project_contributions_visibility_check TO profile_contributions_visibility_check;
--> statement-breakpoint
ALTER TABLE public.workspace_document_versions RENAME CONSTRAINT project_doc_versions_created_by_fkey TO workspace_document_versions_created_by_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_document_versions RENAME CONSTRAINT project_doc_versions_pkey TO workspace_document_versions_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_document_versions RENAME CONSTRAINT project_doc_versions_project_id_doc_id_fkey TO workspace_document_versions_workspace_id_doc_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_document_versions RENAME CONSTRAINT project_doc_versions_project_id_fkey TO workspace_document_versions_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_documents RENAME CONSTRAINT project_docs_id_published_version_id_fkey TO workspace_documents_id_published_version_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_documents RENAME CONSTRAINT project_docs_pkey TO workspace_documents_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_documents RENAME CONSTRAINT project_docs_project_id_fkey TO workspace_documents_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_documents RENAME CONSTRAINT project_docs_project_id_linked_node_id_fkey TO workspace_documents_workspace_id_linked_node_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_event_counters RENAME CONSTRAINT project_event_counters_next_sequence_check TO workspace_event_counters_next_sequence_check;
--> statement-breakpoint
ALTER TABLE public.workspace_event_counters RENAME CONSTRAINT project_event_counters_pkey TO workspace_event_counters_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_event_counters RENAME CONSTRAINT project_event_counters_project_id_fkey TO workspace_event_counters_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_file_index RENAME CONSTRAINT project_file_index_node_id_project_nodes_id_fk TO workspace_file_index_node_id_workspace_nodes_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_file_index RENAME CONSTRAINT project_file_index_pkey TO workspace_file_index_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_file_index RENAME CONSTRAINT project_file_index_project_id_projects_id_fk TO workspace_file_index_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_follows RENAME CONSTRAINT project_follows_pkey TO workspace_follows_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_follows RENAME CONSTRAINT project_follows_project_id_projects_id_fk TO workspace_follows_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_follows RENAME CONSTRAINT project_follows_user_id_profiles_id_fk TO workspace_follows_user_id_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_action_check TO workspace_git_deltas_action_check;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_file_version_id_fkey TO workspace_git_deltas_file_version_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_node_id_fkey TO workspace_git_deltas_node_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_pkey TO workspace_git_deltas_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_project_id_fkey TO workspace_git_deltas_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_seq_unique TO workspace_git_deltas_seq_unique;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_status_check TO workspace_git_deltas_status_check;
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas RENAME CONSTRAINT project_git_deltas_task_id_fkey TO workspace_git_deltas_task_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME CONSTRAINT project_guidance_appointments_ended_by_fkey TO workspace_mentors_ended_by_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME CONSTRAINT project_guidance_appointments_guide_user_id_fkey TO workspace_mentors_guide_user_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME CONSTRAINT project_guidance_appointments_invitation_id_fkey TO workspace_mentors_invitation_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME CONSTRAINT project_guidance_appointments_pkey TO workspace_mentors_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME CONSTRAINT project_guidance_appointments_previous_membership_role_check TO workspace_mentors_previous_membership_role_check;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME CONSTRAINT project_guidance_appointments_project_id_fkey TO workspace_mentors_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_mentors RENAME CONSTRAINT project_guidance_appointments_status_check TO workspace_mentors_status_check;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_candidate_id_fkey TO workspace_invitations_candidate_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_inviter_id_fkey TO workspace_invitations_inviter_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_kind_check TO workspace_invitations_kind_check;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_pkey TO workspace_invitations_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_project_id_fkey TO workspace_invitations_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_resolved_by_fkey TO workspace_invitations_resolved_by_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_role_id_fkey TO workspace_invitations_role_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_snapshot_check TO workspace_invitations_snapshot_check;
--> statement-breakpoint
ALTER TABLE public.workspace_invitations RENAME CONSTRAINT project_invitations_status_check TO workspace_invitations_status_check;
--> statement-breakpoint
ALTER TABLE public.workspace_members RENAME CONSTRAINT project_members_pkey TO workspace_members_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_members RENAME CONSTRAINT project_members_project_id_projects_id_fk TO workspace_members_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_members RENAME CONSTRAINT project_members_title_length TO workspace_members_title_length;
--> statement-breakpoint
ALTER TABLE public.workspace_members RENAME CONSTRAINT project_members_unit_id_fkey TO workspace_members_unit_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_members RENAME CONSTRAINT project_members_user_id_profiles_id_fk TO workspace_members_user_id_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_node_conflicts RENAME CONSTRAINT project_node_conflicts_conflict_status_check TO workspace_node_conflicts_conflict_status_check;
--> statement-breakpoint
ALTER TABLE public.workspace_node_conflicts RENAME CONSTRAINT project_node_conflicts_node_id_fkey TO workspace_node_conflicts_node_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_conflicts RENAME CONSTRAINT project_node_conflicts_pkey TO workspace_node_conflicts_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_conflicts RENAME CONSTRAINT project_node_conflicts_project_id_fkey TO workspace_node_conflicts_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_conflicts RENAME CONSTRAINT project_node_conflicts_task_id_fkey TO workspace_node_conflicts_task_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_events RENAME CONSTRAINT project_node_events_actor_id_fkey TO workspace_node_events_actor_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_events RENAME CONSTRAINT project_node_events_pkey TO workspace_node_events_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_events RENAME CONSTRAINT project_node_events_project_id_fkey TO workspace_node_events_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_events RENAME CONSTRAINT project_node_events_project_id_node_id_fkey TO workspace_node_events_workspace_id_node_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks RENAME CONSTRAINT project_node_locks_client_kind_check TO workspace_node_locks_client_kind_check;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks RENAME CONSTRAINT project_node_locks_device_session_fk TO workspace_node_locks_device_session_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks RENAME CONSTRAINT project_node_locks_locked_by_profiles_id_fk TO workspace_node_locks_locked_by_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks RENAME CONSTRAINT project_node_locks_node_id_project_nodes_id_fk TO workspace_node_locks_node_id_workspace_nodes_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks RENAME CONSTRAINT project_node_locks_pkey TO workspace_node_locks_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks RENAME CONSTRAINT project_node_locks_project_id_projects_id_fk TO workspace_node_locks_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_asset_id_fkey TO workspace_nodes_asset_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_created_by_profiles_id_fk TO workspace_nodes_created_by_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_deleted_by_profiles_id_fk TO workspace_nodes_deleted_by_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_no_self_parent_check TO workspace_nodes_no_self_parent_check;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_pkey TO workspace_nodes_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_project_id_canonical_node_id_fkey TO workspace_nodes_workspace_id_canonical_node_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_project_id_parent_id_fkey TO workspace_nodes_workspace_id_parent_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_project_id_projects_id_fk TO workspace_nodes_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_project_id_task_id_fkey TO workspace_nodes_workspace_id_task_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes RENAME CONSTRAINT project_nodes_sync_status_check TO workspace_nodes_sync_status_check;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME CONSTRAINT project_open_roles_count_non_negative_check TO workspace_open_roles_count_non_negative_check;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME CONSTRAINT project_open_roles_filled_lte_count_check TO workspace_open_roles_filled_lte_count_check;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME CONSTRAINT project_open_roles_filled_non_negative_check TO workspace_open_roles_filled_non_negative_check;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME CONSTRAINT project_open_roles_lead_user_id_fkey TO workspace_open_roles_lead_user_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME CONSTRAINT project_open_roles_pkey TO workspace_open_roles_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles RENAME CONSTRAINT project_open_roles_project_id_projects_id_fk TO workspace_open_roles_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_skills RENAME CONSTRAINT project_skills_pkey TO workspace_skills_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_skills RENAME CONSTRAINT project_skills_project_id_projects_id_fk TO workspace_skills_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_skills RENAME CONSTRAINT project_skills_skill_id_skills_id_fk TO workspace_skills_skill_id_skills_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_sprint_events RENAME CONSTRAINT project_sprint_events_actor_id_fkey TO workspace_sprint_events_actor_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_sprint_events RENAME CONSTRAINT project_sprint_events_pkey TO workspace_sprint_events_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_sprint_events RENAME CONSTRAINT project_sprint_events_project_id_fkey TO workspace_sprint_events_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_sprint_events RENAME CONSTRAINT project_sprint_events_sprint_id_fkey TO workspace_sprint_events_sprint_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints RENAME CONSTRAINT project_sprints_creator_id_fkey TO workspace_sprints_creator_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints RENAME CONSTRAINT project_sprints_parent_sprint_id_fkey TO workspace_sprints_parent_sprint_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints RENAME CONSTRAINT project_sprints_pkey TO workspace_sprints_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints RENAME CONSTRAINT project_sprints_project_id_projects_id_fk TO workspace_sprints_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_tags RENAME CONSTRAINT project_tags_pkey TO workspace_tags_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_tags RENAME CONSTRAINT project_tags_project_id_projects_id_fk TO workspace_tags_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_tags RENAME CONSTRAINT project_tags_tag_id_tags_id_fk TO workspace_tags_tag_id_tags_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_task_policy_events RENAME CONSTRAINT project_task_policy_events_actor_id_fkey TO workspace_task_policy_events_actor_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_task_policy_events RENAME CONSTRAINT project_task_policy_events_pkey TO workspace_task_policy_events_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_task_policy_events RENAME CONSTRAINT project_task_policy_events_project_id_fkey TO workspace_task_policy_events_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_deleted_by_fkey TO workspace_update_comments_deleted_by_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_no_self_parent_check TO workspace_update_comments_no_self_parent_check;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_pkey TO workspace_update_comments_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_project_id_fkey TO workspace_update_comments_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_project_id_update_id_fkey TO workspace_update_comments_workspace_id_update_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_target_user_id_profiles_id_fk TO workspace_update_comments_target_user_id_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_update_id_parent_id_fkey TO workspace_update_comments_update_id_parent_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments RENAME CONSTRAINT project_update_comments_user_id_fkey TO workspace_update_comments_user_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_draft_media_assets RENAME CONSTRAINT project_update_draft_media_assets_asset_id_fkey TO workspace_update_draft_media_assets_asset_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_draft_media_assets RENAME CONSTRAINT project_update_draft_media_assets_ordinal_check TO workspace_update_draft_media_assets_ordinal_check;
--> statement-breakpoint
ALTER TABLE public.workspace_update_draft_media_assets RENAME CONSTRAINT project_update_draft_media_assets_pkey TO workspace_update_draft_media_assets_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_draft_media_assets RENAME CONSTRAINT project_update_draft_media_assets_project_id_user_id_fkey TO workspace_update_draft_media_assets_workspace_id_user_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_drafts RENAME CONSTRAINT project_update_drafts_project_id_projects_id_fk TO workspace_update_drafts_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_update_drafts RENAME CONSTRAINT project_update_drafts_project_id_user_id_pkey TO workspace_update_drafts_workspace_id_user_id_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_drafts RENAME CONSTRAINT project_update_drafts_user_id_profiles_id_fk TO workspace_update_drafts_user_id_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspace_update_likes RENAME CONSTRAINT project_update_likes_pkey TO workspace_update_likes_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_likes RENAME CONSTRAINT project_update_likes_update_id_fkey TO workspace_update_likes_update_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_likes RENAME CONSTRAINT project_update_likes_user_id_fkey TO workspace_update_likes_user_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_media_assets RENAME CONSTRAINT project_update_media_assets_asset_id_fkey TO workspace_update_media_assets_asset_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_media_assets RENAME CONSTRAINT project_update_media_assets_ordinal_check TO workspace_update_media_assets_ordinal_check;
--> statement-breakpoint
ALTER TABLE public.workspace_update_media_assets RENAME CONSTRAINT project_update_media_assets_pkey TO workspace_update_media_assets_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_update_media_assets RENAME CONSTRAINT project_update_media_assets_update_id_fkey TO workspace_update_media_assets_update_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_author_id_fkey TO workspace_updates_author_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_comment_count_nonnegative TO workspace_updates_comment_count_nonnegative;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_deleted_by_fkey TO workspace_updates_deleted_by_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_like_count_nonnegative TO workspace_updates_like_count_nonnegative;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_notify_level_check TO workspace_updates_notify_level_check;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_pkey TO workspace_updates_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_project_id_fkey TO workspace_updates_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_reply_policy_check TO workspace_updates_reply_policy_check;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_update_type_check TO workspace_updates_update_type_check;
--> statement-breakpoint
ALTER TABLE public.workspace_updates RENAME CONSTRAINT project_updates_visibility_check TO workspace_updates_visibility_check;
--> statement-breakpoint
ALTER TABLE public.workspace_workflow_columns RENAME CONSTRAINT project_workflow_columns_pkey TO workspace_workflow_columns_pkey;
--> statement-breakpoint
ALTER TABLE public.workspace_workflow_columns RENAME CONSTRAINT project_workflow_columns_project_id_fkey TO workspace_workflow_columns_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_cover_image_asset_id_fkey TO workspaces_cover_image_asset_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_key_unique TO workspaces_key_unique;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_kind_check TO workspaces_kind_check;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_org_has_no_parent TO workspaces_org_has_no_parent;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_org_type_check TO workspaces_org_type_check;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_owner_id_profiles_id_fk TO workspaces_owner_id_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_parent_id_fkey TO workspaces_parent_id_fkey;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_pkey TO workspaces_pkey;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_slug_unique TO workspaces_slug_unique;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_status_emoji_check TO workspaces_status_emoji_check;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_status_set_by_fkey TO workspaces_status_set_by_fkey;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_status_text_check TO workspaces_status_text_check;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_term_check TO workspaces_term_check;
--> statement-breakpoint
ALTER TABLE public.workspaces RENAME CONSTRAINT projects_verified_by_fkey TO workspaces_verified_by_fkey;
--> statement-breakpoint
ALTER TABLE public.role_applications RENAME CONSTRAINT role_applications_project_id_projects_id_fk TO role_applications_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.role_applications RENAME CONSTRAINT role_applications_role_id_project_open_roles_id_fk TO role_applications_role_id_workspace_open_roles_id_fk;
--> statement-breakpoint
ALTER TABLE public.sprint_task_memberships RENAME CONSTRAINT sprint_task_memberships_project_id_fkey TO sprint_task_memberships_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.task_activity_events RENAME CONSTRAINT task_activity_events_project_id_fkey TO task_activity_events_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.task_node_links RENAME CONSTRAINT task_node_links_node_id_project_nodes_id_fk TO task_node_links_node_id_workspace_nodes_id_fk;
--> statement-breakpoint
ALTER TABLE public.task_pushes RENAME CONSTRAINT task_pushes_project_id_fkey TO task_pushes_workspace_id_fkey;
--> statement-breakpoint
ALTER TABLE public.tasks RENAME CONSTRAINT tasks_project_id_projects_id_fk TO tasks_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER TABLE public.tasks RENAME CONSTRAINT tasks_project_id_sprint_id_fkey TO tasks_workspace_id_sprint_id_fkey;
--> statement-breakpoint
ALTER TABLE public.tasks RENAME CONSTRAINT tasks_project_id_timeline_origin_sprint_id_fkey TO tasks_workspace_id_timeline_origin_sprint_id_fkey;
--> statement-breakpoint
ALTER TABLE public.tasks RENAME CONSTRAINT tasks_project_id_workflow_column_id_fkey TO tasks_workspace_id_workflow_column_id_fkey;
--> statement-breakpoint
ALTER TABLE public.upload_intents RENAME CONSTRAINT upload_intents_project_id_projects_id_fk TO upload_intents_workspace_id_workspaces_id_fk;
--> statement-breakpoint
ALTER INDEX public.chat_channels_project_browse_idx RENAME TO chat_channels_workspace_browse_idx;
--> statement-breakpoint
ALTER INDEX public.chat_channels_project_idx RENAME TO chat_channels_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.chat_channels_project_name_uniq RENAME TO chat_channels_workspace_name_uniq;
--> statement-breakpoint
ALTER INDEX public.content_reports_project_idx RENAME TO content_reports_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.extension_recovery_drafts_project_path_idx RENAME TO extension_recovery_drafts_workspace_path_idx;
--> statement-breakpoint
ALTER INDEX public.github_sync_runs_project_idx RENAME TO github_sync_runs_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.import_jobs_project_idx RENAME TO import_jobs_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.org_email_invites_child_project_idx RENAME TO org_email_invites_child_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.profile_contribution_stages_project_idx RENAME TO profile_contribution_stages_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contribution_stages_contribution_idx RENAME TO profile_contribution_stages_contribution_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contribution_stages_contribution_ref_idx RENAME TO profile_contribution_stages_contribution_ref_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contribution_stages_current_unique RENAME TO profile_contribution_stages_current_unique;
--> statement-breakpoint
ALTER INDEX public.profile_project_contribution_stages_event_unique RENAME TO profile_contribution_stages_event_unique;
--> statement-breakpoint
ALTER INDEX public.profile_project_contribution_stages_profile_project_idx RENAME TO profile_contribution_stages_profile_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contribution_stages_profile_ref_idx RENAME TO profile_contribution_stages_profile_ref_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contribution_stages_visible_idx RENAME TO profile_contribution_stages_visible_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_profile_external_active_unique RENAME TO profile_contributions_profile_external_active_unique;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_profile_idx RENAME TO profile_contributions_profile_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_profile_project_active_unique RENAME TO profile_contributions_profile_workspace_active_unique;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_profile_visible_idx RENAME TO profile_contributions_profile_visible_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_project_idx RENAME TO profile_contributions_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_project_ref_idx RENAME TO profile_contributions_workspace_ref_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_verified_by_idx RENAME TO profile_contributions_verified_by_idx;
--> statement-breakpoint
ALTER INDEX public.profile_project_contributions_verified_idx RENAME TO profile_contributions_verified_idx;
--> statement-breakpoint
ALTER INDEX public.profiles_projects_count_idx RENAME TO profiles_workspaces_count_idx;
--> statement-breakpoint
ALTER INDEX public.project_doc_versions_created_by_idx RENAME TO workspace_document_versions_created_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_doc_versions_doc_id_version_number_key RENAME TO workspace_document_versions_doc_id_version_number_key;
--> statement-breakpoint
ALTER INDEX public.project_doc_versions_project_deleted_idx RENAME TO workspace_document_versions_workspace_deleted_idx;
--> statement-breakpoint
ALTER INDEX public.project_docs_linked_node_idx RENAME TO workspace_documents_linked_node_idx;
--> statement-breakpoint
ALTER INDEX public.project_docs_project_idx RENAME TO workspace_documents_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.project_docs_published_version_idx RENAME TO workspace_documents_published_version_idx;
--> statement-breakpoint
ALTER INDEX public.project_docs_slug_unique RENAME TO workspace_documents_slug_unique;
--> statement-breakpoint
ALTER INDEX public.project_file_index_content_search_idx RENAME TO workspace_file_index_content_search_idx;
--> statement-breakpoint
ALTER INDEX public.project_file_index_project_id_idx RENAME TO workspace_file_index_workspace_id_idx;
--> statement-breakpoint
ALTER INDEX public.project_follows_project_id_idx RENAME TO workspace_follows_workspace_id_idx;
--> statement-breakpoint
ALTER INDEX public.project_follows_unique_idx RENAME TO workspace_follows_unique_idx;
--> statement-breakpoint
ALTER INDEX public.project_follows_user_id_idx RENAME TO workspace_follows_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.project_git_deltas_file_version_idx RENAME TO workspace_git_deltas_file_version_idx;
--> statement-breakpoint
ALTER INDEX public.project_git_deltas_node_idx RENAME TO workspace_git_deltas_node_idx;
--> statement-breakpoint
ALTER INDEX public.project_git_deltas_sync_idx RENAME TO workspace_git_deltas_sync_idx;
--> statement-breakpoint
ALTER INDEX public.project_git_deltas_task_idx RENAME TO workspace_git_deltas_task_idx;
--> statement-breakpoint
ALTER INDEX public.project_guidance_appointments_active_project_unique RENAME TO workspace_mentors_active_workspace_unique;
--> statement-breakpoint
ALTER INDEX public.project_guidance_appointments_ended_by_idx RENAME TO workspace_mentors_ended_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_guidance_appointments_guide_active_idx RENAME TO workspace_mentors_guide_active_idx;
--> statement-breakpoint
ALTER INDEX public.project_guidance_appointments_guide_idx RENAME TO workspace_mentors_guide_idx;
--> statement-breakpoint
ALTER INDEX public.project_guidance_appointments_invitation_idx RENAME TO workspace_mentors_invitation_idx;
--> statement-breakpoint
ALTER INDEX public.project_guidance_appointments_project_guide_idx RENAME TO workspace_mentors_workspace_guide_idx;
--> statement-breakpoint
ALTER INDEX public.project_invitations_candidate_inbox_idx RENAME TO workspace_invitations_candidate_inbox_idx;
--> statement-breakpoint
ALTER INDEX public.project_invitations_expires_idx RENAME TO workspace_invitations_expires_idx;
--> statement-breakpoint
ALTER INDEX public.project_invitations_idempotency_unique RENAME TO workspace_invitations_idempotency_unique;
--> statement-breakpoint
ALTER INDEX public.project_invitations_inviter_idx RENAME TO workspace_invitations_inviter_idx;
--> statement-breakpoint
ALTER INDEX public.project_invitations_pending_guidance_unique RENAME TO workspace_invitations_pending_guidance_unique;
--> statement-breakpoint
ALTER INDEX public.project_invitations_pending_ordinary_unique RENAME TO workspace_invitations_pending_ordinary_unique;
--> statement-breakpoint
ALTER INDEX public.project_invitations_project_candidate_idx RENAME TO workspace_invitations_workspace_candidate_idx;
--> statement-breakpoint
ALTER INDEX public.project_invitations_resolved_by_idx RENAME TO workspace_invitations_resolved_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_invitations_role_idx RENAME TO workspace_invitations_role_idx;
--> statement-breakpoint
ALTER INDEX public.project_members_file_upload_idx RENAME TO workspace_members_file_upload_idx;
--> statement-breakpoint
ALTER INDEX public.project_members_project_idx RENAME TO workspace_members_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.project_members_project_user_unique RENAME TO workspace_members_workspace_user_unique;
--> statement-breakpoint
ALTER INDEX public.project_members_unit_idx RENAME TO workspace_members_unit_idx;
--> statement-breakpoint
ALTER INDEX public.project_members_user_idx RENAME TO workspace_members_user_idx;
--> statement-breakpoint
ALTER INDEX public.project_members_user_role_idx RENAME TO workspace_members_user_role_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_conflicts_node_idx RENAME TO workspace_node_conflicts_node_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_conflicts_project_idx RENAME TO workspace_node_conflicts_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_conflicts_task_idx RENAME TO workspace_node_conflicts_task_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_events_actor_id_idx RENAME TO workspace_node_events_actor_id_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_events_node_idx RENAME TO workspace_node_events_node_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_events_operation_idx RENAME TO workspace_node_events_operation_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_events_project_idx RENAME TO workspace_node_events_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_events_reconciliation_key_idx RENAME TO workspace_node_events_reconciliation_key_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_events_seq_idx RENAME TO workspace_node_events_seq_idx;
--> statement-breakpoint
ALTER SEQUENCE public.project_node_lock_fencing_seq RENAME TO workspace_node_lock_fencing_seq;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_cleanup_idx RENAME TO workspace_node_locks_cleanup_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_device_session_idx RENAME TO workspace_node_locks_device_session_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_expires_idx RENAME TO workspace_node_locks_expires_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_lease_unique RENAME TO workspace_node_locks_lease_unique;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_locked_by_idx RENAME TO workspace_node_locks_locked_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_owner_session_idx RENAME TO workspace_node_locks_owner_session_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_project_expires_idx RENAME TO workspace_node_locks_workspace_expires_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_project_id_idx RENAME TO workspace_node_locks_workspace_id_idx;
--> statement-breakpoint
ALTER INDEX public.project_node_locks_project_node_expires_idx RENAME TO workspace_node_locks_workspace_node_expires_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_access_folders_idx RENAME TO workspace_nodes_access_folders_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_active_file_idx RENAME TO workspace_nodes_active_file_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_active_file_s3_key_idx RENAME TO workspace_nodes_active_file_s3_key_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_active_name_lookup_idx RENAME TO workspace_nodes_active_name_lookup_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_active_parent_idx RENAME TO workspace_nodes_active_parent_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_active_parent_name_unique RENAME TO workspace_nodes_active_parent_name_unique;
--> statement-breakpoint
ALTER INDEX public.project_nodes_active_project_path_unique RENAME TO workspace_nodes_active_workspace_path_unique;
--> statement-breakpoint
ALTER INDEX public.project_nodes_asset_idx RENAME TO workspace_nodes_asset_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_canonical_idx RENAME TO workspace_nodes_canonical_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_canonical_node_idx RENAME TO workspace_nodes_canonical_node_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_created_by_idx RENAME TO workspace_nodes_created_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_deleted_at_partial_idx RENAME TO workspace_nodes_deleted_at_partial_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_deleted_by_idx RENAME TO workspace_nodes_deleted_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_file_s3_key_idx RENAME TO workspace_nodes_file_s3_key_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_listing_idx RENAME TO workspace_nodes_listing_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_parent_id_idx RENAME TO workspace_nodes_parent_id_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_path_idx RENAME TO workspace_nodes_path_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_permanent_delete_root_idx RENAME TO workspace_nodes_permanent_delete_root_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_project_deleted_updated_idx RENAME TO workspace_nodes_workspace_deleted_updated_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_project_id_idx RENAME TO workspace_nodes_workspace_id_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_project_path_idx RENAME TO workspace_nodes_workspace_path_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_project_updated_idx RENAME TO workspace_nodes_workspace_updated_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_root_covering_idx RENAME TO workspace_nodes_root_covering_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_sync_git_idx RENAME TO workspace_nodes_sync_git_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_task_idx RENAME TO workspace_nodes_task_idx;
--> statement-breakpoint
ALTER INDEX public.project_nodes_task_status_idx RENAME TO workspace_nodes_task_status_idx;
--> statement-breakpoint
ALTER INDEX public.project_open_roles_lead_user_idx RENAME TO workspace_open_roles_lead_user_idx;
--> statement-breakpoint
ALTER INDEX public.project_open_roles_project_idx RENAME TO workspace_open_roles_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.project_open_roles_project_updated_idx RENAME TO workspace_open_roles_workspace_updated_idx;
--> statement-breakpoint
ALTER INDEX public.project_skills_project_order_idx RENAME TO workspace_skills_workspace_order_idx;
--> statement-breakpoint
ALTER INDEX public.project_skills_skill_idx RENAME TO workspace_skills_skill_idx;
--> statement-breakpoint
ALTER INDEX public.project_skills_unique_idx RENAME TO workspace_skills_unique_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprint_events_actor_idx RENAME TO workspace_sprint_events_actor_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprint_events_project_created_idx RENAME TO workspace_sprint_events_workspace_created_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprint_events_sprint_created_idx RENAME TO workspace_sprint_events_sprint_created_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprints_creator_idx RENAME TO workspace_sprints_creator_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprints_one_active_idx RENAME TO workspace_sprints_one_active_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprints_parent_idx RENAME TO workspace_sprints_parent_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprints_project_idx RENAME TO workspace_sprints_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprints_project_number_idx RENAME TO workspace_sprints_workspace_number_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprints_project_updated_idx RENAME TO workspace_sprints_workspace_updated_idx;
--> statement-breakpoint
ALTER INDEX public.project_sprints_status_idx RENAME TO workspace_sprints_status_idx;
--> statement-breakpoint
ALTER INDEX public.project_tags_tag_idx RENAME TO workspace_tags_tag_idx;
--> statement-breakpoint
ALTER INDEX public.project_tags_unique_idx RENAME TO workspace_tags_unique_idx;
--> statement-breakpoint
ALTER INDEX public.project_task_policy_events_actor_idx RENAME TO workspace_task_policy_events_actor_idx;
--> statement-breakpoint
ALTER INDEX public.project_task_policy_events_version_idx RENAME TO workspace_task_policy_events_version_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_active_parent_idx RENAME TO workspace_update_comments_active_parent_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_deleted_by_idx RENAME TO workspace_update_comments_deleted_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_parent_idx RENAME TO workspace_update_comments_parent_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_project_created_idx RENAME TO workspace_update_comments_workspace_created_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_target_user_idx RENAME TO workspace_update_comments_target_user_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_update_active_idx RENAME TO workspace_update_comments_update_active_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_update_created_idx RENAME TO workspace_update_comments_update_created_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_comments_user_created_idx RENAME TO workspace_update_comments_user_created_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_draft_media_assets_asset_idx RENAME TO workspace_update_draft_media_assets_asset_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_draft_media_assets_ordinal_unique RENAME TO workspace_update_draft_media_assets_ordinal_unique;
--> statement-breakpoint
ALTER INDEX public.project_update_drafts_updated_at_idx RENAME TO workspace_update_drafts_updated_at_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_drafts_user_idx RENAME TO workspace_update_drafts_user_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_likes_unique RENAME TO workspace_update_likes_unique;
--> statement-breakpoint
ALTER INDEX public.project_update_likes_update_idx RENAME TO workspace_update_likes_update_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_likes_user_idx RENAME TO workspace_update_likes_user_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_media_assets_asset_idx RENAME TO workspace_update_media_assets_asset_idx;
--> statement-breakpoint
ALTER INDEX public.project_update_media_assets_update_asset_unique RENAME TO workspace_update_media_assets_update_asset_unique;
--> statement-breakpoint
ALTER INDEX public.project_update_media_assets_update_ordinal_unique RENAME TO workspace_update_media_assets_update_ordinal_unique;
--> statement-breakpoint
ALTER INDEX public.project_updates_author_created_idx RENAME TO workspace_updates_author_created_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_deleted_at_idx RENAME TO workspace_updates_deleted_at_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_deleted_by_idx RENAME TO workspace_updates_deleted_by_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_discover_feed_idx RENAME TO workspace_updates_discover_feed_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_member_feed_idx RENAME TO workspace_updates_member_feed_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_project_created_active_idx RENAME TO workspace_updates_workspace_created_active_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_project_pinned_created_idx RENAME TO workspace_updates_workspace_pinned_created_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_public_feed_idx RENAME TO workspace_updates_public_feed_idx;
--> statement-breakpoint
ALTER INDEX public.project_updates_shared_idx RENAME TO workspace_updates_shared_idx;
--> statement-breakpoint
ALTER INDEX public.project_workflow_columns_project_default_status_idx RENAME TO workspace_workflow_columns_workspace_default_status_idx;
--> statement-breakpoint
ALTER INDEX public.project_workflow_columns_project_position_idx RENAME TO workspace_workflow_columns_workspace_position_idx;
--> statement-breakpoint
ALTER INDEX public.projects_category_status_idx RENAME TO workspaces_category_status_idx;
--> statement-breakpoint
ALTER INDEX public.projects_cover_image_asset_idx RENAME TO workspaces_cover_image_asset_idx;
--> statement-breakpoint
ALTER INDEX public.projects_created_at_idx RENAME TO workspaces_created_at_idx;
--> statement-breakpoint
ALTER INDEX public.projects_created_at_status_idx RENAME TO workspaces_created_at_status_idx;
--> statement-breakpoint
ALTER INDEX public.projects_deletion_scheduled_idx RENAME TO workspaces_deletion_scheduled_idx;
--> statement-breakpoint
ALTER INDEX public.projects_description_search_idx RENAME TO workspaces_description_search_idx;
--> statement-breakpoint
ALTER INDEX public.projects_discover_most_followed_idx RENAME TO workspaces_discover_most_followed_idx;
--> statement-breakpoint
ALTER INDEX public.projects_discover_most_viewed_idx RENAME TO workspaces_discover_most_viewed_idx;
--> statement-breakpoint
ALTER INDEX public.projects_discover_newest_idx RENAME TO workspaces_discover_newest_idx;
--> statement-breakpoint
ALTER INDEX public.projects_feed_most_viewed_idx RENAME TO workspaces_feed_most_viewed_idx;
--> statement-breakpoint
ALTER INDEX public.projects_join_code_unique RENAME TO workspaces_join_code_unique;
--> statement-breakpoint
ALTER INDEX public.projects_my_projects_idx RENAME TO workspaces_my_workspaces_idx;
--> statement-breakpoint
ALTER INDEX public.projects_owner_deleted_view_count_idx RENAME TO workspaces_owner_deleted_view_count_idx;
--> statement-breakpoint
ALTER INDEX public.projects_owner_idx RENAME TO workspaces_owner_idx;
--> statement-breakpoint
ALTER INDEX public.projects_parent_idx RENAME TO workspaces_parent_idx;
--> statement-breakpoint
ALTER INDEX public.projects_public_feed_most_followed_active_idx RENAME TO workspaces_public_feed_most_followed_active_idx;
--> statement-breakpoint
ALTER INDEX public.projects_status_idx RENAME TO workspaces_status_idx;
--> statement-breakpoint
ALTER INDEX public.projects_status_set_by_idx RENAME TO workspaces_status_set_by_idx;
--> statement-breakpoint
ALTER INDEX public.projects_status_visibility_idx RENAME TO workspaces_status_visibility_idx;
--> statement-breakpoint
ALTER INDEX public.projects_title_search_idx RENAME TO workspaces_title_search_idx;
--> statement-breakpoint
ALTER INDEX public.projects_verification_requested_idx RENAME TO workspaces_verification_requested_idx;
--> statement-breakpoint
ALTER INDEX public.projects_verified_by_idx RENAME TO workspaces_verified_by_idx;
--> statement-breakpoint
ALTER INDEX public.role_applications_pending_project_idx RENAME TO role_applications_pending_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.role_applications_project_role_pending_idx RENAME TO role_applications_workspace_role_pending_idx;
--> statement-breakpoint
ALTER INDEX public.role_applications_project_updated_idx RENAME TO role_applications_workspace_updated_idx;
--> statement-breakpoint
ALTER INDEX public.sprint_task_memberships_project_id_idx RENAME TO sprint_task_memberships_workspace_id_idx;
--> statement-breakpoint
ALTER INDEX public.storage_assets_project_idx RENAME TO storage_assets_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.task_activity_events_project_created_idx RENAME TO task_activity_events_workspace_created_idx;
--> statement-breakpoint
ALTER INDEX public.task_pushes_project_idx RENAME TO task_pushes_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.tasks_active_project_status_position_idx RENAME TO tasks_active_workspace_status_position_idx;
--> statement-breakpoint
ALTER INDEX public.tasks_project_assignee_idx RENAME TO tasks_workspace_assignee_idx;
--> statement-breakpoint
ALTER INDEX public.tasks_project_idx RENAME TO tasks_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.tasks_project_number_idx RENAME TO tasks_workspace_number_idx;
--> statement-breakpoint
ALTER INDEX public.tasks_project_sprint_idx RENAME TO tasks_workspace_sprint_idx;
--> statement-breakpoint
ALTER INDEX public.tasks_project_status_idx RENAME TO tasks_workspace_status_idx;
--> statement-breakpoint
ALTER INDEX public.tasks_project_updated_idx RENAME TO tasks_workspace_updated_idx;
--> statement-breakpoint
ALTER INDEX public.upload_intents_project_idx RENAME TO upload_intents_workspace_idx;
--> statement-breakpoint
ALTER INDEX public.upload_intents_project_status_idx RENAME TO upload_intents_workspace_status_idx;
--> statement-breakpoint
ALTER POLICY application_events_select_actor_or_project_admin ON public.application_events RENAME TO application_events_select_actor_or_workspace_admin;
--> statement-breakpoint
ALTER POLICY comment_mentions_insert_project_member ON public.comment_mentions RENAME TO comment_mentions_insert_workspace_member;
--> statement-breakpoint
ALTER POLICY comment_mentions_select_author_or_project_admin ON public.comment_mentions RENAME TO comment_mentions_select_author_or_workspace_admin;
--> statement-breakpoint
ALTER POLICY file_versions_insert_project_member ON public.file_versions RENAME TO file_versions_insert_workspace_member;
--> statement-breakpoint
ALTER POLICY project_doc_versions_delete_project_writer ON public.workspace_document_versions RENAME TO workspace_document_versions_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_doc_versions_insert_project_writer ON public.workspace_document_versions RENAME TO workspace_document_versions_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_doc_versions_read ON public.workspace_document_versions RENAME TO workspace_document_versions_read;
--> statement-breakpoint
ALTER POLICY project_doc_versions_update_project_writer ON public.workspace_document_versions RENAME TO workspace_document_versions_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_docs_delete_project_writer ON public.workspace_documents RENAME TO workspace_documents_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_docs_insert_project_writer ON public.workspace_documents RENAME TO workspace_documents_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_docs_read ON public.workspace_documents RENAME TO workspace_documents_read;
--> statement-breakpoint
ALTER POLICY project_docs_update_project_writer ON public.workspace_documents RENAME TO workspace_documents_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_file_index_delete_project_writer ON public.workspace_file_index RENAME TO workspace_file_index_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_file_index_insert_project_writer ON public.workspace_file_index RENAME TO workspace_file_index_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_file_index_read ON public.workspace_file_index RENAME TO workspace_file_index_read;
--> statement-breakpoint
ALTER POLICY project_file_index_update_project_writer ON public.workspace_file_index RENAME TO workspace_file_index_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_follows_delete_own ON public.workspace_follows RENAME TO workspace_follows_delete_own;
--> statement-breakpoint
ALTER POLICY project_follows_insert_own ON public.workspace_follows RENAME TO workspace_follows_insert_own;
--> statement-breakpoint
ALTER POLICY project_follows_select_visible ON public.workspace_follows RENAME TO workspace_follows_select_visible;
--> statement-breakpoint
ALTER POLICY project_follows_update_own ON public.workspace_follows RENAME TO workspace_follows_update_own;
--> statement-breakpoint
ALTER POLICY project_guidance_appointments_select_author_or_project_admin ON public.workspace_mentors RENAME TO workspace_mentors_select_author_or_workspace_admin;
--> statement-breakpoint
ALTER POLICY project_invitations_select_project_member ON public.workspace_invitations RENAME TO workspace_invitations_select_workspace_member;
--> statement-breakpoint
ALTER POLICY project_members_select_visible ON public.workspace_members RENAME TO workspace_members_select_visible;
--> statement-breakpoint
ALTER POLICY project_node_events_delete_project_writer ON public.workspace_node_events RENAME TO workspace_node_events_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_node_events_insert_project_writer ON public.workspace_node_events RENAME TO workspace_node_events_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_node_events_select_project_member ON public.workspace_node_events RENAME TO workspace_node_events_select_workspace_member;
--> statement-breakpoint
ALTER POLICY project_node_events_update_project_writer ON public.workspace_node_events RENAME TO workspace_node_events_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_node_locks_select_project_member ON public.workspace_node_locks RENAME TO workspace_node_locks_select_workspace_member;
--> statement-breakpoint
ALTER POLICY project_nodes_delete_project_writer ON public.workspace_nodes RENAME TO workspace_nodes_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_nodes_insert_project_writer ON public.workspace_nodes RENAME TO workspace_nodes_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_nodes_read ON public.workspace_nodes RENAME TO workspace_nodes_read;
--> statement-breakpoint
ALTER POLICY project_nodes_update_project_writer ON public.workspace_nodes RENAME TO workspace_nodes_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_open_roles_delete_project_admin ON public.workspace_open_roles RENAME TO workspace_open_roles_delete_workspace_admin;
--> statement-breakpoint
ALTER POLICY project_open_roles_insert_project_admin ON public.workspace_open_roles RENAME TO workspace_open_roles_insert_workspace_admin;
--> statement-breakpoint
ALTER POLICY project_open_roles_select_visible ON public.workspace_open_roles RENAME TO workspace_open_roles_select_visible;
--> statement-breakpoint
ALTER POLICY project_open_roles_update_project_admin ON public.workspace_open_roles RENAME TO workspace_open_roles_update_workspace_admin;
--> statement-breakpoint
ALTER POLICY project_skills_select_visible ON public.workspace_skills RENAME TO workspace_skills_select_visible;
--> statement-breakpoint
ALTER POLICY project_sprints_delete_project_writer ON public.workspace_sprints RENAME TO workspace_sprints_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_sprints_insert_project_writer ON public.workspace_sprints RENAME TO workspace_sprints_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_sprints_select_visible ON public.workspace_sprints RENAME TO workspace_sprints_select_visible;
--> statement-breakpoint
ALTER POLICY project_sprints_update_project_writer ON public.workspace_sprints RENAME TO workspace_sprints_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY project_tags_select_visible ON public.workspace_tags RENAME TO workspace_tags_select_visible;
--> statement-breakpoint
ALTER POLICY project_update_comments_insert_visible ON public.workspace_update_comments RENAME TO workspace_update_comments_insert_visible;
--> statement-breakpoint
ALTER POLICY project_update_comments_read ON public.workspace_update_comments RENAME TO workspace_update_comments_read;
--> statement-breakpoint
ALTER POLICY project_update_comments_update_author_or_project_admin ON public.workspace_update_comments RENAME TO workspace_update_comments_update_author_or_workspace_admin;
--> statement-breakpoint
ALTER POLICY project_update_drafts_all_project_member ON public.workspace_update_drafts RENAME TO workspace_update_drafts_all_workspace_member;
--> statement-breakpoint
ALTER POLICY project_update_likes_delete_own ON public.workspace_update_likes RENAME TO workspace_update_likes_delete_own;
--> statement-breakpoint
ALTER POLICY project_update_likes_insert_visible ON public.workspace_update_likes RENAME TO workspace_update_likes_insert_visible;
--> statement-breakpoint
ALTER POLICY project_update_likes_select_visible ON public.workspace_update_likes RENAME TO workspace_update_likes_select_visible;
--> statement-breakpoint
ALTER POLICY project_updates_insert_project_member ON public.workspace_updates RENAME TO workspace_updates_insert_workspace_member;
--> statement-breakpoint
ALTER POLICY project_updates_read ON public.workspace_updates RENAME TO workspace_updates_read;
--> statement-breakpoint
ALTER POLICY project_updates_update_author_or_project_admin ON public.workspace_updates RENAME TO workspace_updates_update_author_or_workspace_admin;
--> statement-breakpoint
ALTER POLICY project_workflow_columns_read ON public.workspace_workflow_columns RENAME TO workspace_workflow_columns_read;
--> statement-breakpoint
ALTER POLICY projects_insert_own ON public.workspaces RENAME TO workspaces_insert_own;
--> statement-breakpoint
ALTER POLICY projects_read ON public.workspaces RENAME TO workspaces_read;
--> statement-breakpoint
ALTER POLICY projects_update_own ON public.workspaces RENAME TO workspaces_update_own;
--> statement-breakpoint
ALTER POLICY role_applications_select_actor_or_project_admin ON public.role_applications RENAME TO role_applications_select_actor_or_workspace_admin;
--> statement-breakpoint
ALTER POLICY task_node_links_delete_project_writer ON public.task_node_links RENAME TO task_node_links_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY task_node_links_insert_project_writer ON public.task_node_links RENAME TO task_node_links_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY task_node_links_update_project_writer ON public.task_node_links RENAME TO task_node_links_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY task_subtasks_delete_project_writer ON public.task_subtasks RENAME TO task_subtasks_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY task_subtasks_insert_project_writer ON public.task_subtasks RENAME TO task_subtasks_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY task_subtasks_update_project_writer ON public.task_subtasks RENAME TO task_subtasks_update_workspace_writer;
--> statement-breakpoint
ALTER POLICY tasks_delete_project_writer ON public.tasks RENAME TO tasks_delete_workspace_writer;
--> statement-breakpoint
ALTER POLICY tasks_insert_project_writer ON public.tasks RENAME TO tasks_insert_workspace_writer;
--> statement-breakpoint
ALTER POLICY tasks_update_project_writer ON public.tasks RENAME TO tasks_update_workspace_writer;
--> statement-breakpoint
ALTER TRIGGER project_node_events_sequence_before_insert ON public.workspace_node_events RENAME TO workspace_node_events_sequence_before_insert;
--> statement-breakpoint
ALTER TRIGGER project_open_roles_sync_count ON public.workspace_open_roles RENAME TO workspace_open_roles_sync_count;
--> statement-breakpoint
ALTER TRIGGER project_update_comments_read_only_guard ON public.workspace_update_comments RENAME TO workspace_update_comments_read_only_guard;
--> statement-breakpoint
ALTER TRIGGER project_updates_pin_limit ON public.workspace_updates RENAME TO workspace_updates_pin_limit;
--> statement-breakpoint
ALTER TRIGGER project_updates_read_only_guard ON public.workspace_updates RENAME TO workspace_updates_read_only_guard;
--> statement-breakpoint
ALTER TRIGGER projects_drop_chat_on_soft_delete ON public.workspaces RENAME TO workspaces_drop_chat_on_soft_delete;
--> statement-breakpoint
ALTER TRIGGER projects_seed_workflow_columns ON public.workspaces RENAME TO workspaces_seed_workflow_columns;
--> statement-breakpoint
ALTER TRIGGER projects_two_levels ON public.workspaces RENAME TO workspaces_two_levels;
--> statement-breakpoint
ALTER TRIGGER task_node_links_before_write_same_project_trigger ON public.task_node_links RENAME TO task_node_links_before_write_same_workspace_trigger;
--> statement-breakpoint
ALTER TRIGGER user_notifications_cascade_project ON public.workspaces RENAME TO user_notifications_cascade_workspace;
--> statement-breakpoint
ALTER FUNCTION app_private.chat_is_project_member(p_project_id uuid, p_user_id uuid) RENAME TO chat_is_workspace_member;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_can_read(p_project_id uuid) RENAME TO nb_workspace_can_read;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_can_admin(p_project_id uuid) RENAME TO nb_workspace_can_admin;
--> statement-breakpoint
ALTER FUNCTION public.allocate_project_node_event_sequence() RENAME TO allocate_workspace_node_event_sequence;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_public_doc_visible(p_project_id uuid) RENAME TO nb_workspace_public_doc_visible;
--> statement-breakpoint
ALTER FUNCTION public.sync_project_open_roles_count() RENAME TO sync_workspace_open_roles_count;
--> statement-breakpoint
ALTER FUNCTION public.seed_project_workflow_columns() RENAME TO seed_workspace_workflow_columns;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_update_pin_limit() RENAME TO nb_workspace_update_pin_limit;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_doc_member_can_read(p_project_id uuid, p_settings jsonb) RENAME TO nb_workspace_doc_member_can_read;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_task_node_link_same_project() RENAME TO nb_task_node_link_same_workspace;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_tab_visible(p_project_id uuid, p_tab text) RENAME TO nb_workspace_tab_visible;
--> statement-breakpoint
ALTER FUNCTION app_private.drop_chat_of_deleted_project() RENAME TO drop_chat_of_deleted_workspace;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_projects_two_levels() RENAME TO nb_workspaces_two_levels;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_can_write(p_project_id uuid) RENAME TO nb_workspace_can_write;
--> statement-breakpoint
ALTER FUNCTION app_private.chat_sync_project_members(p_project_id uuid, p_user_id uuid, p_op text) RENAME TO chat_sync_workspace_members;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone) RENAME TO nb_workspace_node_can_read;
--> statement-breakpoint
ALTER FUNCTION app_private.chat_reparent_project(p_project_id uuid) RENAME TO chat_reparent_workspace;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_read_only(p_project_id uuid) RENAME TO nb_workspace_read_only;
--> statement-breakpoint
ALTER FUNCTION app_private.nb_project_read_only_guard() RENAME TO nb_workspace_read_only_guard;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_can_dm(p_from uuid, p_to uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_from = p_to THEN true
    WHEN app_private.chat_is_blocked(p_from, p_to) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND deleted_at IS NULL) THEN false
    WHEN (SELECT coalesce(message_privacy, 'connections') FROM public.profiles WHERE id = p_to) = 'everyone' THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces o
      JOIN public.workspace_members a ON a.workspace_id = o.id AND a.user_id = p_from AND a.role <> 'viewer'
      JOIN public.workspace_members b ON b.workspace_id = o.id AND b.user_id = p_to AND b.role <> 'viewer'
      WHERE o.kind = 'organization' AND o.deleted_at IS NULL
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.status = 'accepted'
        AND ((c.requester_id = p_from AND c.addressee_id = p_to) OR (c.requester_id = p_to AND c.addressee_id = p_from))
    )
  END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT member_count FROM public.chat_channels WHERE id = p_channel_id) + cardinality(p_users) > 500
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_channels c JOIN public.workspaces p ON p.id = c.workspace_id
       WHERE c.id = p_channel_id AND c.is_default AND p.kind = 'organization'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_member_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(p_users);
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_is_workspace_member(p_project_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.workspace_members pm
    JOIN public.workspaces p ON p.id = pm.workspace_id AND p.deleted_at IS NULL
    WHERE pm.workspace_id = p_project_id AND pm.user_id = p_user_id
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_is_channel_admin(p_channel_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id AND m.role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.workspace_members pm ON pm.workspace_id = c.workspace_id
    WHERE c.id = p_channel_id AND pm.user_id = p_user_id AND pm.role IN ('owner', 'admin')
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_set_channel_privacy(p_channel_id uuid, p_actor uuid, p_private boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_channel record;
  v_kind text := CASE WHEN p_private THEN 'private' ELSE 'public' END;
BEGIN
  SELECT kind, name, workspace_id, application_id, is_default, archived_at INTO v_channel
  FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind = 'dm' OR v_channel.name IS NULL OR v_channel.workspace_id IS NULL
     OR v_channel.application_id IS NOT NULL OR v_channel.is_default OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_privacy_fixed';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  IF v_channel.kind = v_kind THEN
    RETURN;
  END IF;
  UPDATE public.chat_channels SET kind = v_kind WHERE id = p_channel_id;
  PERFORM app_private.chat_post_system(p_channel_id, p_actor, CASE WHEN p_private THEN 'made the channel private' ELSE 'made the channel public' END);
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_can_read(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = p_project_id AND pm.user_id = (SELECT auth.uid()))
        OR (p.visibility IN ('public', 'unlisted') AND coalesce(p.status::text, 'draft') <> 'draft')
        OR (p.parent_id IS NOT NULL AND (
          app_private.nb_org_role(p.parent_id) IN ('owner', 'admin')
          OR (p.visibility = 'org' AND coalesce(p.status::text, 'draft') <> 'draft' AND app_private.nb_org_role(p.parent_id) IS NOT NULL)
        ))
      )
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_can_admin(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members pm
          WHERE pm.workspace_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin')
        )
      )
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_document_versions v
    JOIN public.workspace_documents d
      ON d.id = v.doc_id
     AND d.published_version_id = v.id
    WHERE v.id = p_version_id
      AND v.deleted_at IS NULL
      AND COALESCE(d.settings ->> 'visibilityOverride', 'inherit_project') IN ('inherit_project', 'public')
      AND app_private.nb_workspace_public_doc_visible(v.workspace_id)
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.allocate_workspace_node_event_sequence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE next_value bigint;
BEGIN
  IF NEW.sequence_number IS NULL OR NEW.sequence_number = 0 THEN
    INSERT INTO public.workspace_event_counters(workspace_id, next_sequence, updated_at)
    VALUES (NEW.workspace_id, 1, now())
    ON CONFLICT (workspace_id) DO UPDATE
      SET next_sequence = public.workspace_event_counters.next_sequence + 1,
          updated_at = now()
    RETURNING next_sequence INTO next_value;
    NEW.sequence_number := next_value;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.workspace_event_counters
      WHERE workspace_id = NEW.workspace_id AND next_sequence >= NEW.sequence_number
    ) THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.workspace_event_counters(workspace_id, next_sequence, updated_at)
    VALUES (NEW.workspace_id, NEW.sequence_number, now())
    ON CONFLICT (workspace_id) DO UPDATE
      SET next_sequence = greatest(public.workspace_event_counters.next_sequence, excluded.next_sequence),
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_public_doc_visible(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND p.visibility = 'public'
      AND coalesce(p.status::text, 'draft') <> 'draft'
      AND COALESCE(p.public_tab_visibility ->> 'readme', 'true') = 'true'
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sync_workspace_open_roles_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.workspaces p
  SET open_roles_count = (
    SELECT count(*) FROM public.workspace_open_roles r WHERE r.workspace_id = p.id AND r.filled < r.count
  )
  WHERE p.id IN (
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.workspace_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.workspace_id END
  );
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_add_members(p_channel_id uuid, p_actor uuid, p_users uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_channel record;
  v_new uuid[];
  v_added integer;
BEGIN
  SELECT kind, workspace_id, archived_at, application_id INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind = 'dm' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF v_channel.application_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_application_members_fixed';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_new
  FROM unnest(coalesce(p_users, '{}')) AS u
  WHERE u IS NOT NULL AND NOT app_private.chat_is_member(p_channel_id, u);
  IF cardinality(v_new) = 0 THEN
    RETURN 0;
  END IF;
  IF v_channel.workspace_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(v_new) AS u WHERE NOT app_private.chat_is_workspace_member(v_channel.workspace_id, u)) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM unnest(v_new) AS u WHERE NOT app_private.chat_can_dm(p_actor, u)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_dm_not_allowed';
  END IF;
  PERFORM app_private.chat_assert_capacity(p_channel_id, v_new);

  INSERT INTO public.chat_channel_members (channel_id, user_id)
  SELECT p_channel_id, u FROM unnest(v_new) AS u
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  UPDATE public.chat_channels SET member_count = member_count + v_added WHERE id = p_channel_id;
  IF v_added > 0 THEN
    PERFORM app_private.chat_post_system(
      p_channel_id, p_actor,
      'added ' || (SELECT string_agg('<@' || u || '>', ', ') FROM unnest(v_new) AS u)
    );
  END IF;
  RETURN v_added;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_workspace_member(p_project_id, p_creator) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspaces p
    WHERE p.id = p_project_id AND p.kind = 'organization' AND p.owner_id <> p_creator
      AND NOT coalesce((p.org_settings->>'membersCreateChannels')::boolean, p.org_type IS DISTINCT FROM 'education')
      AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p.id AND m.user_id = p_creator AND m.role = 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_org_channels_admins_only';
  END IF;
  IF p_name IS NULL OR p_name !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_channel_name';
  END IF;
  -- Serialize channel creation per project so the 200-channel limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-project-channels:' || p_project_id::text, 0));
  IF (
    SELECT count(*) FROM public.chat_channels
    WHERE workspace_id = p_project_id AND application_id IS NULL AND archived_at IS NULL
  ) >= 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_channel_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(ARRAY[p_creator]);

  INSERT INTO public.chat_channels (kind, name, description, workspace_id, created_by, member_count)
  VALUES (CASE WHEN p_private THEN 'private' ELSE 'public' END, p_name, nullif(btrim(coalesce(p_description, '')), ''),
          p_project_id, p_creator, 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role) VALUES (v_id, p_creator, 'owner');
  PERFORM app_private.chat_post_system(v_id, p_creator, 'created #' || p_name);
  RETURN v_id;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_ensure_application_channel(p_application_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_app record;
  v_id uuid;
  v_added integer;
  v_seq bigint;
  v_card jsonb;
BEGIN
  SELECT a.id, a.workspace_id, a.applicant_id, a.message INTO v_app
  FROM public.role_applications a WHERE a.id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_application_not_found';
  END IF;
  v_card := jsonb_build_object('kind', 'application', 'ref_id', p_application_id);

  SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = v_id AND k.kind = 'application' AND k.ref_id = p_application_id) THEN
      SELECT channel_seq INTO v_seq FROM public.chat_messages
      WHERE channel_id = v_id AND client_message_id = 'application:' || p_application_id AND deleted_at IS NULL;
      IF FOUND THEN
        INSERT INTO public.chat_message_cards (channel_id, message_seq, kind, ref_id)
        VALUES (v_id, v_seq, 'application', p_application_id);
      ELSE
        PERFORM app_private.chat_append_message(
          v_id, v_app.applicant_id, 'user', left(coalesce(v_app.message, ''), 4000), 'application-card:' || p_application_id,
          NULL, '[]'::jsonb, v_card
        );
      END IF;
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channels (kind, workspace_id, application_id, created_by)
  VALUES ('private', v_app.workspace_id, p_application_id, v_app.applicant_id)
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_id, v_app.applicant_id, 'member'
  UNION
  SELECT v_id, p.owner_id, 'owner' FROM public.workspaces p WHERE p.id = v_app.workspace_id
  UNION
  SELECT v_id, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' ELSE 'admin' END
  FROM public.workspace_members pm
  WHERE pm.workspace_id = v_app.workspace_id AND pm.role IN ('owner', 'admin')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  UPDATE public.chat_channels SET member_count = v_added WHERE id = v_id;

  PERFORM app_private.chat_append_message(
    v_id, v_app.applicant_id, 'user', left(coalesce(v_app.message, ''), 4000), 'application:' || p_application_id,
    NULL, '[]'::jsonb, v_card
  );
  RETURN v_id;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_rename_group(p_channel_id uuid, p_actor uuid, p_title text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_channels
    WHERE id = p_channel_id AND kind = 'private' AND name IS NULL AND workspace_id IS NULL AND application_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_input';
  END IF;
  UPDATE public.chat_channels SET title = v_title WHERE id = p_channel_id AND title IS DISTINCT FROM v_title;
  IF FOUND THEN
    PERFORM app_private.chat_post_system(p_channel_id, p_actor,
      CASE WHEN v_title IS NULL THEN 'removed the group name' ELSE 'named the group ' || v_title END);
  END IF;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.seed_workspace_workflow_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.workspace_workflow_columns (
    workspace_id, status, title, accent_class_name, empty_title,
    empty_description, position, is_default
  )
  VALUES
    (NEW.id, 'todo', 'To Do', 'zinc', 'Tasks will appear here...', 'Tasks that are ready to start will appear here. Drag and drop your tasks here.', 0, TRUE),
    (NEW.id, 'in_progress', 'In Progress', 'blue', 'Tasks will appear here...', 'Items will appear here as soon as they start. Drag and drop your tasks here.', 1, TRUE),
    (NEW.id, 'blocked', 'Issues', 'rose', 'Tasks will appear here...', 'Tasks waiting on blockers will appear here. Drag and drop your tasks here.', 2, TRUE),
    (NEW.id, 'done', 'Done', 'emerald', 'Tasks will appear here...', 'Finished work will appear here. Drag and drop your tasks here.', 3, TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_update_pin_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text;
  v_live integer;
  v_limit integer;
BEGIN
  IF NOT NEW.is_pinned OR NEW.deleted_at IS NOT NULL OR (NEW.pinned_until IS NOT NULL AND NEW.pinned_until <= now()) THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO v_kind FROM public.workspaces WHERE id = NEW.workspace_id FOR UPDATE;
  SELECT count(*) INTO v_live
  FROM public.workspace_updates u
  WHERE u.workspace_id = NEW.workspace_id AND u.id <> NEW.id AND u.is_pinned AND u.deleted_at IS NULL
    AND (u.pinned_until IS NULL OR u.pinned_until > now());
  v_limit := CASE WHEN v_kind = 'organization' THEN 3 ELSE 1 END;
  IF v_live >= v_limit THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project_update_pin_limit';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_file_content_contribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE project_uuid uuid;
BEGIN
  IF current_setting('app.maintenance_operation', true) IN ('hash_backfill', 'version_repair') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND (NEW.uploaded_by IS DISTINCT FROM auth.uid() OR NEW.attribution <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'File authorship must match the authenticated actor';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.s3_key IS NOT DISTINCT FROM OLD.s3_key
    AND NEW.size IS NOT DISTINCT FROM OLD.size
    AND NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.content_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.file_versions previous WHERE previous.node_id=NEW.node_id
      AND previous.version=NEW.version-1 AND previous.content_hash=NEW.content_hash
  ) THEN RETURN NEW; END IF;
  SELECT workspace_id INTO project_uuid FROM public.workspace_nodes WHERE id = NEW.node_id;
  INSERT INTO public.workspace_node_events(workspace_id,node_id,actor_id,type,sequence_number,metadata)
  VALUES (project_uuid,NEW.node_id,NEW.uploaded_by,'file_content_contributed',0,
    jsonb_build_object('version',NEW.version,'hash',NEW.content_hash,'source',COALESCE(NEW.attribution->>'source','edge'),'attribution',NEW.attribution));
  IF NEW.uploaded_by IS NOT NULL THEN
    UPDATE public.profile_collaboration_summaries SET stale=true,updated_at=now() WHERE profile_id=NEW.uploaded_by;
  END IF;
  RETURN NEW;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.workspace_members pm
          WHERE pm.workspace_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND (coalesce(p_settings ->> 'visibilityOverride', 'inherit_project') <> 'leaders_only'
                 OR pm.role IN ('owner', 'admin'))
        )
      )
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_task_node_link_same_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t JOIN public.workspace_nodes n ON n.workspace_id = t.workspace_id
    WHERE t.id = NEW.task_id AND n.id = NEW.node_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'task_node_links: task and node belong to different projects';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = p_project_id AND pm.user_id = (SELECT auth.uid()))
        OR (p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IN ('owner', 'admin'))
        OR (
          coalesce(p.status::text, 'draft') <> 'draft'
          AND (p.visibility IN ('public', 'unlisted')
               OR (p.visibility = 'org' AND p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IS NOT NULL))
          AND coalesce(p.public_tab_visibility ->> p_tab, CASE WHEN p_tab IN ('tasks', 'sprints') THEN 'false' ELSE 'true' END) = 'true'
        )
      )
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    p_target_user_id = (SELECT auth.uid())
    OR (
      app_private.nb_presence_activity_visible((SELECT auth.uid()), p_target_user_id)
      AND (
        EXISTS (
          SELECT 1
          FROM public.chat_channel_members viewer
          JOIN public.chat_channels c ON c.id = viewer.channel_id AND (c.kind = 'dm' OR (c.kind = 'private' AND c.name IS NULL))
          JOIN public.chat_channel_members target ON target.channel_id = viewer.channel_id
          WHERE viewer.user_id = (SELECT auth.uid())
            AND target.user_id = p_target_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members viewer
          JOIN public.workspace_members target
            ON target.workspace_id = viewer.workspace_id
          WHERE viewer.user_id = (SELECT auth.uid())
            AND target.user_id = p_target_user_id
        )
      )
    );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.drop_chat_of_deleted_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.chat_channels WHERE workspace_id = NEW.id;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_application_cast(p_project_id uuid, p_user_id uuid)
 RETURNS TABLE(channel_id uuid, user_id uuid, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT DISTINCT ON (c.id, w.user_id) c.id, w.user_id, w.role
  FROM public.chat_channels c
  JOIN public.role_applications a ON a.id = c.application_id
  CROSS JOIN LATERAL (
    SELECT a.applicant_id AS user_id, 'member' AS role, 3 AS rank
    UNION ALL
    SELECT p.owner_id, 'owner', 1 FROM public.workspaces p WHERE p.id = c.workspace_id
    UNION ALL
    SELECT pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' ELSE 'admin' END, CASE pm.role WHEN 'owner' THEN 1 ELSE 2 END
    FROM public.workspace_members pm WHERE pm.workspace_id = c.workspace_id AND pm.role IN ('owner', 'admin')
  ) w
  WHERE c.workspace_id = p_project_id AND c.application_id IS NOT NULL
    AND (p_user_id IS NULL OR w.user_id = p_user_id)
  ORDER BY c.id, w.user_id, w.rank
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_reconcile_application_members(p_project_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.chat_channel_members m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND c.workspace_id = p_project_id AND c.application_id IS NOT NULL
    AND (p_user_id IS NULL OR m.user_id = p_user_id)
    AND NOT EXISTS (
      SELECT 1 FROM app_private.chat_application_cast(p_project_id, p_user_id) k
      WHERE k.channel_id = m.channel_id AND k.user_id = m.user_id
    );

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT k.channel_id, k.user_id, k.role FROM app_private.chat_application_cast(p_project_id, p_user_id) k
  ON CONFLICT (channel_id, user_id) DO UPDATE SET role = EXCLUDED.role
  WHERE public.chat_channel_members.role IS DISTINCT FROM EXCLUDED.role;

  UPDATE public.chat_channels c
  SET member_count = counted.n
  FROM (
    SELECT ch.id, (SELECT count(*)::int FROM public.chat_channel_members m WHERE m.channel_id = ch.id) AS n
    FROM public.chat_channels ch WHERE ch.workspace_id = p_project_id AND ch.application_id IS NOT NULL
  ) counted
  WHERE c.id = counted.id AND c.member_count IS DISTINCT FROM counted.n;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_task_visible(p_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.workspaces p ON p.id = t.workspace_id
    WHERE t.id = p_task_id
      AND t.deleted_at IS NULL
      AND app_private.nb_workspace_tab_visible(t.workspace_id, 'tasks')
      AND (
        p.kind <> 'organization'
        OR p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = p.id AND pm.user_id = (SELECT auth.uid()) AND pm.role = 'admin')
        OR (t.kind = 'assignment' AND t.assignment_id IS NULL)
        OR t.assignee_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = (SELECT auth.uid()))
      )
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_send_message(p_channel_id uuid, p_author_id uuid, p_body text, p_client_id text DEFAULT NULL::text, p_thread_root bigint DEFAULT NULL::bigint, p_mentions uuid[] DEFAULT '{}'::uuid[], p_broadcast text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb, p_card jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_channel record;
  v_other uuid;
  v_result jsonb;
  v_seq bigint;
  v_direct boolean;
  v_mentioned uuid[] := '{}';
  v_notify uuid[] := '{}';
  v_muted uuid[] := '{}';
  v_follows uuid[] := '{}';
BEGIN
  p_body := coalesce(p_body, '');
  p_attachments := coalesce(p_attachments, '[]'::jsonb);
  IF char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_body_too_long';
  END IF;
  IF btrim(p_body) = '' AND jsonb_array_length(p_attachments) = 0 AND p_card IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_empty_message';
  END IF;
  IF jsonb_array_length(p_attachments) > 10 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_too_many_attachments';
  END IF;
  IF p_broadcast IS NOT NULL AND p_broadcast NOT IN ('channel', 'here') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_broadcast';
  END IF;

  SELECT id, kind, name, workspace_id, archived_at, member_count, application_id INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_author_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_archived';
  END IF;
  -- An application thread is a shared room: nobody posts into it while blocked with someone else in it.
  IF v_channel.application_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channel_members bm
    WHERE bm.channel_id = p_channel_id AND bm.user_id <> p_author_id AND app_private.chat_is_blocked(p_author_id, bm.user_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
  END IF;
  IF v_channel.kind = 'dm' THEN
    SELECT user_id INTO v_other FROM public.chat_channel_members
    WHERE channel_id = p_channel_id AND user_id <> p_author_id LIMIT 1;
    IF v_other IS NOT NULL AND app_private.chat_is_blocked(p_author_id, v_other) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
    END IF;
  END IF;
  IF p_broadcast IS NOT NULL AND v_channel.member_count > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_broadcast_mention_too_large';
  END IF;

  v_result := app_private.chat_append_message(p_channel_id, p_author_id, 'user', p_body, p_client_id, p_thread_root, p_attachments, p_card);
  IF (v_result->>'deduped')::boolean THEN
    RETURN v_result;
  END IF;
  v_seq := (v_result->>'channel_seq')::bigint;

  IF p_broadcast IS NOT NULL OR cardinality(coalesce(p_mentions, '{}')) > 0 THEN
    SELECT coalesce(array_agg(m.user_id), '{}') INTO v_mentioned
    FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id
      AND m.user_id <> p_author_id
      AND (p_broadcast IS NOT NULL OR m.user_id = ANY (p_mentions));
    -- A follower mentioned in a thread reply already got a 'thread_reply' row from
    -- chat_append_message: the mention wins, so it files under Mentions (#1).
    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT u, p_channel_id, v_seq, coalesce(p_broadcast, 'user') FROM unnest(v_mentioned) AS u
    ON CONFLICT (user_id, channel_id, message_seq) DO UPDATE SET kind = EXCLUDED.kind
      WHERE public.chat_mentions.kind = 'thread_reply';
    UPDATE public.chat_channel_members
    SET mention_count = mention_count + 1, archived_at = NULL
    WHERE channel_id = p_channel_id AND user_id = ANY (v_mentioned);
  END IF;

  -- A new DM or group-chat message brings the conversation back for everyone.
  IF v_channel.kind = 'dm' OR v_channel.kind = 'private' THEN
    UPDATE public.chat_channel_members
    SET archived_at = NULL
    WHERE channel_id = p_channel_id AND user_id <> p_author_id AND archived_at IS NOT NULL;
  END IF;

  -- Who gets a live hint: DM and group-chat members (notify = all), mentioned
  -- members and thread followers. Muted members get a hint only when mentioned
  -- (their badge counts it, #9) and never a push (`muted`). `follows` lists the
  -- thread followers, so a reply only counts for people who follow it (#3).
  -- Skipped for ordinary channel messages so big channels pay nothing extra.
  v_direct := v_channel.kind = 'dm' OR (v_channel.kind = 'private' AND v_channel.workspace_id IS NULL) OR v_channel.application_id IS NOT NULL;
  IF v_direct OR cardinality(v_mentioned) > 0 OR p_thread_root IS NOT NULL THEN
    SELECT coalesce(array_agg(m.user_id), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE m.notify = 'mute'), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE f.user_id IS NOT NULL), '{}')
    INTO v_notify, v_muted, v_follows
    FROM public.chat_channel_members m
    LEFT JOIN public.chat_thread_follows f
      ON p_thread_root IS NOT NULL AND f.user_id = m.user_id AND f.channel_id = p_channel_id AND f.root_seq = p_thread_root
    WHERE m.channel_id = p_channel_id AND m.user_id <> p_author_id
      AND (
        m.user_id = ANY (v_mentioned)
        OR (m.notify <> 'mute' AND ((v_direct AND m.notify = 'all') OR f.user_id IS NOT NULL))
      );
  END IF;

  RETURN v_result || jsonb_build_object('notify', to_jsonb(v_notify), 'muted', to_jsonb(v_muted),
    'follows', to_jsonb(v_follows), 'channel_kind', v_channel.kind);
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_post_member_joined(p_project_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_default uuid;
  v_channel_name text;
  v_already_joined boolean;
BEGIN
  -- 1. Locate default channel for this project
  SELECT id, coalesce(name, 'general') INTO v_default, v_channel_name
  FROM public.chat_channels
  WHERE workspace_id = p_project_id AND is_default;

  IF v_default IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Prevent duplicate join notice if already announced in this project's default channel
  SELECT EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE channel_id = v_default AND author_id = p_user_id AND kind = 'system'
      AND body LIKE 'joined #%' AND deleted_at IS NULL
  ) INTO v_already_joined;

  IF v_already_joined THEN
    RETURN v_default;
  END IF;

  -- 3. Post lean Slack-style join system notice
  PERFORM app_private.chat_post_system(v_default, p_user_id, 'joined #' || v_channel_name);

  RETURN v_default;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspaces_two_levels()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspaces p WHERE p.id = NEW.parent_id AND p.kind = 'organization' FOR SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project_parent_must_be_org';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.kind = 'organization' AND NEW.kind <> 'organization'
     AND EXISTS (SELECT 1 FROM public.workspaces c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'org_has_child_projects';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_org_role(p_org_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN o.owner_id = (SELECT auth.uid()) THEN 'owner' ELSE pm.role END
  FROM public.workspaces o
  LEFT JOIN public.workspace_members pm ON pm.workspace_id = o.id AND pm.user_id = (SELECT auth.uid())
  WHERE o.id = p_org_id AND o.kind = 'organization' AND o.deleted_at IS NULL;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_can_write(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members pm
          WHERE pm.workspace_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin', 'member')
        )
        OR (p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IN ('owner', 'admin'))
      )
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_sync_workspace_members(p_project_id uuid, p_user_id uuid, p_op text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_default uuid;
  v_added integer;
  v_is_org boolean;
  v_notify text;
BEGIN
  IF p_op = 'remove' THEN
    WITH removed AS (
      DELETE FROM public.chat_channel_members m
      USING public.chat_channels c
      WHERE c.id = m.channel_id AND c.workspace_id = p_project_id AND c.application_id IS NULL AND m.user_id = p_user_id
      RETURNING m.channel_id
    )
    UPDATE public.chat_channels c
    SET member_count = greatest(c.member_count - 1, 0)
    FROM removed WHERE c.id = removed.channel_id;
    PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
    RETURN NULL;
  END IF;

  IF p_op NOT IN ('ensure_default', 'add', 'role') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_sync_op';
  END IF;

  -- Org #general starts at the org's default notify level: Mentions for Education, All otherwise (report §25.4).
  SELECT kind = 'organization',
         CASE WHEN kind = 'organization' THEN coalesce(nullif(org_settings->>'generalNotify', ''), CASE WHEN org_type = 'education' THEN 'mentions' ELSE 'all' END) ELSE 'all' END
    INTO v_is_org, v_notify FROM public.workspaces WHERE id = p_project_id;
  IF v_notify NOT IN ('all', 'mentions', 'mute') THEN v_notify := 'all'; END IF;
  SELECT id INTO v_default FROM public.chat_channels WHERE workspace_id = p_project_id AND is_default;
  IF NOT FOUND THEN
    INSERT INTO public.chat_channels (kind, name, workspace_id, is_default, description, created_by)
    SELECT 'public', app_private.chat_default_channel_name(p.id), p.id, true,
           CASE WHEN p.parent_id IS NOT NULL THEN 'Everyone in ' || p.title ELSE 'Everyone in the project' END, p.owner_id
    FROM public.workspaces p WHERE p.id = p_project_id
    ON CONFLICT (workspace_id) WHERE is_default DO NOTHING
    RETURNING id INTO v_default;
    IF v_default IS NULL THEN
      SELECT id INTO v_default FROM public.chat_channels WHERE workspace_id = p_project_id AND is_default;
    END IF;
    IF v_default IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_not_found';
    END IF;
  END IF;

  IF p_op = 'role' THEN
    UPDATE public.chat_channel_members m
    SET role = CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END
    FROM public.workspace_members pm
    WHERE m.channel_id = v_default AND m.user_id = p_user_id
      AND pm.workspace_id = p_project_id AND pm.user_id = p_user_id;
    PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
    RETURN v_default;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role, notify)
  SELECT v_default, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END, v_notify
  FROM public.workspace_members pm
  WHERE pm.workspace_id = p_project_id AND (p_user_id IS NULL OR pm.user_id = p_user_id)
    AND NOT (coalesce(v_is_org, false) AND pm.role = 'viewer')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + v_added WHERE id = v_default;
    IF p_user_id IS NOT NULL THEN
      PERFORM app_private.chat_post_member_joined(p_project_id, p_user_id);
    END IF;
  END IF;
  PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
  RETURN v_default;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_audience IS NULL OR p_audience = '{}'::jsonb
    OR p_author_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspaces p WHERE p.id = p_project_id AND p.owner_id = (SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.workspace_members pm
      WHERE pm.workspace_id = p_project_id AND pm.user_id = (SELECT auth.uid())
        AND (pm.role = 'admin' OR p_audience->'roles' @> to_jsonb(pm.role))
    )
    OR (p_audience->'projectIds' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.workspace_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.workspace_id::text IN (SELECT jsonb_array_elements_text(p_audience->'projectIds'))
    ));
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    -- Owners and admins see the whole tree and every copy.
    WHEN EXISTS (SELECT 1 FROM public.workspaces p WHERE p.id = p_project_id AND p.owner_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p_project_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin')
      THEN true
    ELSE
      (p_task_id IS NULL OR app_private.nb_task_visible(p_task_id))
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_nodes f
        WHERE f.workspace_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
          AND f.metadata->>'access' = 'admins'
          AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
      )
      AND (
        -- Members and guests read everything but Admins-only; visitors only under Public folders.
        EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p_project_id AND m.user_id = (SELECT auth.uid()))
        OR (
          EXISTS (
            SELECT 1 FROM public.workspace_nodes f
            WHERE f.workspace_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
              AND f.metadata->>'access' = 'public'
              AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.workspace_nodes f
            WHERE f.workspace_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
              AND f.metadata->>'access' = 'members'
              AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
          )
        )
      )
  END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_deleted_at IS NULL AND EXISTS (
    SELECT 1
    FROM public.workspaces project
    WHERE project.id = p_project_id
      AND project.deleted_at IS NULL
      AND (
        project.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.workspace_members member
          WHERE member.workspace_id = p_project_id
            AND member.user_id = (SELECT auth.uid())
        )
        OR (
          project.visibility = 'public'
          AND coalesce(project.status, 'draft') <> 'draft'
          AND coalesce(project.public_tab_visibility->>'files', 'true') = 'true'
          AND (
            (p_task_id IS NULL AND coalesce(p_path, '') NOT LIKE '/.system/%')
            OR coalesce(project.public_tab_visibility->>'tasks', 'false') = 'true'
          )
        )
      )
      AND (project.kind <> 'organization' OR app_private.nb_org_node_access_ok(p_project_id, p_task_id, p_path))
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_default_channel_name(p_project_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.workspaces o WHERE o.id = p.parent_id AND o.kind = 'organization')
      THEN coalesce(nullif(left(trim(both '-' FROM regexp_replace(lower(coalesce(p.slug, p.title)), '[^a-z0-9-]+', '-', 'g')), 80), ''), 'general')
    ELSE 'general'
  END
  FROM public.workspaces p WHERE p.id = p_project_id
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_is_parent_org_admin(p_project_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspaces c JOIN public.workspaces o ON o.id = c.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
    WHERE c.id = p_project_id AND c.deleted_at IS NULL
      AND (o.owner_id = p_user_id OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = o.id AND m.user_id = p_user_id AND m.role = 'admin'))
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_channel record;
  v_added integer;
  v_supervisor boolean := false;
BEGIN
  SELECT kind, workspace_id, archived_at, name INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind <> 'public' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_not_joinable';
  END IF;
  IF NOT app_private.chat_is_workspace_member(v_channel.workspace_id, p_user_id) THEN
    v_supervisor := app_private.chat_is_parent_org_admin(v_channel.workspace_id, p_user_id);
    IF NOT v_supervisor THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
    END IF;
  END IF;
  PERFORM app_private.chat_assert_capacity(p_channel_id, ARRAY[p_user_id]);
  INSERT INTO public.chat_channel_members (channel_id, user_id, notify)
  VALUES (p_channel_id, p_user_id, CASE WHEN v_supervisor THEN 'mentions' ELSE 'all' END) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + 1 WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_user_id, 'joined #' || coalesce(v_channel.name, 'general'));
  END IF;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_org_general_post_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.kind = 'user' AND NEW.author_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channels c JOIN public.workspaces p ON p.id = c.workspace_id
    WHERE c.id = NEW.channel_id AND c.is_default AND p.kind = 'organization'
      AND coalesce((p.org_settings->>'generalAdminsOnly')::boolean, false)
      AND p.owner_id <> NEW.author_id
      AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p.id AND m.user_id = NEW.author_id AND m.role = 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_general_admins_only';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_org_read_only_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.kind = 'user' AND EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.workspaces p ON p.id = c.workspace_id
    LEFT JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization'
    WHERE c.id = NEW.channel_id AND (
      p.suspended_at IS NOT NULL OR p.deletion_scheduled_at IS NOT NULL
      OR (p.kind = 'organization' AND p.status = 'archived')
      OR o.suspended_at IS NOT NULL
      OR (o.status = 'archived' AND p.status = 'archived')
      OR (o.id IS NOT NULL AND p.status = 'archived')
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_org_read_only';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_reparent_workspace(p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_default uuid;
  v_old text;
  v_new text;
BEGIN
  SELECT id, name INTO v_default, v_old FROM public.chat_channels WHERE workspace_id = p_project_id AND is_default;
  v_new := app_private.chat_default_channel_name(p_project_id);
  IF v_default IS NOT NULL AND v_old IS DISTINCT FROM v_new THEN
    UPDATE public.chat_channels SET name = v_new WHERE id = v_default;
    PERFORM app_private.chat_post_system(v_default, NULL, 'renamed the channel to #' || v_new);
  END IF;
  WITH gone AS (
    DELETE FROM public.chat_channel_members m
    USING public.chat_channels c
    WHERE c.id = m.channel_id AND c.workspace_id = p_project_id AND c.application_id IS NULL
      AND NOT app_private.chat_is_workspace_member(p_project_id, m.user_id)
      AND NOT app_private.chat_is_parent_org_admin(p_project_id, m.user_id)
    RETURNING m.channel_id
  )
  UPDATE public.chat_channels c SET member_count = greatest(c.member_count - n.k, 0)
  FROM (SELECT channel_id, count(*)::int AS k FROM gone GROUP BY channel_id) n
  WHERE c.id = n.channel_id;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH mine AS (
    SELECT c.id, c.kind, c.name, c.title, c.topic, c.workspace_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
           c.last_message_at, c.last_preview, c.last_author_id, c.member_count, c.archived_at AS channel_archived_at,
           m.role, m.last_read_seq, m.mention_count, m.notify, m.starred, m.archived_at, m.joined_at
    FROM public.chat_channel_members m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user_id
      AND (p_since IS NULL OR c.last_message_at > p_since OR m.joined_at > p_since)
      -- A deleted project owns no chat: its channels and its project row stay out of the sidebar.
      AND NOT EXISTS (SELECT 1 FROM public.workspaces dp WHERE dp.id = c.workspace_id AND dp.deleted_at IS NOT NULL)
  ), ranked AS (
    SELECT mine.*, row_number() OVER (PARTITION BY (kind = 'dm') ORDER BY last_message_at DESC NULLS LAST) AS rn
    FROM mine
  )
  SELECT jsonb_build_object(
    'server_time', now(),
    'activity_latest_at', (SELECT max(created_at) FROM public.chat_mentions WHERE user_id = p_user_id),
    'inbox_unread', app_private.chat_inbox_unread(p_user_id),
    'channels', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'name', r.name, 'title', r.title, 'topic', r.topic, 'project_id', r.workspace_id,
        'application_id', r.application_id, 'is_default', r.is_default, 'last_seq', r.last_seq,
        'last_top_seq', r.last_top_seq, 'last_read_seq', r.last_read_seq, 'mention_count', r.mention_count,
        'notify', r.notify, 'starred', r.starred, 'archived_at', r.archived_at,
        'channel_archived_at', r.channel_archived_at, 'last_message_at', r.last_message_at,
        'last_preview', r.last_preview, 'last_author_id', r.last_author_id, 'member_count', r.member_count,
        'role', r.role,
        'dm_user', CASE WHEN r.kind = 'dm' THEN (
          SELECT jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
          FROM public.chat_channel_members o JOIN public.profiles p ON p.id = o.user_id
          WHERE o.channel_id = r.id
          ORDER BY (o.user_id = p_user_id) LIMIT 1
        ) END,
        'members_preview', CASE WHEN r.kind = 'private' AND r.name IS NULL THEN (
          SELECT jsonb_agg(jsonb_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name, 'avatar_url', x.avatar_url))
          FROM (
            SELECT p.id, p.username, p.full_name, p.avatar_url
            FROM public.chat_channel_members o JOIN public.profiles p ON p.id = o.user_id
            WHERE o.channel_id = r.id AND o.user_id <> p_user_id
            ORDER BY o.joined_at LIMIT 3
          ) x
        ) END
      ))
      FROM ranked r
      WHERE r.kind <> 'dm' OR r.rn <= 100
    ), '[]'::jsonb),
    -- Org workspaces (0249): each project says its kind and parent org, so the client groups child projects
    -- under their org; org admins also get the child projects whose channels they joined (role 'org_admin').
    'projects', CASE WHEN p_since IS NULL THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'slug', x.slug, 'cover_image', x.cover_image, 'role', x.role,
                                          'kind', x.kind, 'parent_id', x.parent_id, 'parent_title', x.parent_title) ORDER BY x.title)
      FROM (
        SELECT p.id, p.title, p.slug, p.cover_image, pm.role, p.kind, o.id AS parent_id, o.title AS parent_title
        FROM public.workspace_members pm JOIN public.workspaces p ON p.id = pm.workspace_id
        LEFT JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE pm.user_id = p_user_id AND p.deleted_at IS NULL
        UNION
        SELECT p.id, p.title, p.slug, p.cover_image, 'org_admin', p.kind, o.id, o.title
        FROM public.chat_channel_members cm JOIN public.chat_channels c ON c.id = cm.channel_id AND c.application_id IS NULL
        JOIN public.workspaces p ON p.id = c.workspace_id AND p.deleted_at IS NULL
        JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE cm.user_id = p_user_id AND NOT EXISTS (SELECT 1 FROM public.workspace_members own WHERE own.workspace_id = p.id AND own.user_id = p_user_id)
      ) x
    ), '[]'::jsonb) END
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_read_only(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces p
    LEFT JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization'
    WHERE p.id = p_project_id AND (
      p.suspended_at IS NOT NULL OR p.deletion_scheduled_at IS NOT NULL
      OR (p.kind = 'organization' AND p.status = 'archived')
      OR o.suspended_at IS NOT NULL
      OR (o.status = 'archived' AND p.status = 'archived')
    )
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_read_only_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_project uuid;
BEGIN
  IF TG_TABLE_NAME = 'project_update_comments' THEN
    SELECT u.workspace_id INTO v_project FROM public.workspace_updates u WHERE u.id = NEW.update_id;
  ELSIF TG_TABLE_NAME = 'task_comments' THEN
    SELECT t.workspace_id INTO v_project FROM public.tasks t WHERE t.id = NEW.task_id;
  ELSE
    v_project := NEW.workspace_id;
  END IF;
  IF v_project IS NOT NULL AND app_private.nb_workspace_read_only(v_project) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_read_only';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE VIEW public.projects WITH (security_invoker = true) AS SELECT id, owner_id, title, description, short_description, cover_image, category, tags, skills, visibility, status, looking_for_collaborators, max_collaborators, created_at, updated_at, slug, view_count, problem_statement, solution_statement, lifecycle_stages, current_stage_index, key, current_task_number, import_source, sync_status, followers_count, saves_count, github_repo_url, github_default_branch, github_last_sync_at, github_last_commit_sha, deleted_at, cover_image_bucket, cover_image_key, public_tab_visibility, notification_preferences, stage_completion_dates, current_sequence_number, member_updates_enabled, open_roles_count, external_links, external_link_metadata, member_file_upload_default, cover_image_asset_id, status_text, status_expires_at, status_set_by, status_set_at, status_emoji, task_review_required, task_completion_policy_version, kind, parent_id, org_type, org_settings, term_start, term_end, time_zone, welcome_note, join_code, join_code_enabled, verified_at, verified_by, verification_domain, suspended_at, suspend_reason, deletion_scheduled_at, discover_hidden_at, verification_requested_at FROM public.workspaces;
--> statement-breakpoint
COMMENT ON VIEW public.projects IS 'Old name of workspaces (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.projects TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.projects TO service_role;
--> statement-breakpoint
GRANT SELECT (category, cover_image, cover_image_asset_id, cover_image_bucket, cover_image_key, created_at, current_sequence_number, current_stage_index, current_task_number, deleted_at, description, external_link_metadata, external_links, followers_count, github_default_branch, github_last_commit_sha, github_last_sync_at, github_repo_url, id, key, lifecycle_stages, looking_for_collaborators, max_collaborators, member_file_upload_default, member_updates_enabled, notification_preferences, open_roles_count, owner_id, problem_statement, public_tab_visibility, saves_count, short_description, skills, slug, solution_statement, stage_completion_dates, status, status_emoji, status_expires_at, status_set_at, status_set_by, status_text, sync_status, tags, title, updated_at, view_count, visibility) ON public.projects TO anon;
--> statement-breakpoint
GRANT SELECT (category, cover_image, cover_image_asset_id, cover_image_bucket, cover_image_key, created_at, current_sequence_number, current_stage_index, current_task_number, deleted_at, description, external_link_metadata, external_links, followers_count, github_default_branch, github_last_commit_sha, github_last_sync_at, github_repo_url, id, key, lifecycle_stages, looking_for_collaborators, max_collaborators, member_file_upload_default, member_updates_enabled, notification_preferences, open_roles_count, owner_id, problem_statement, public_tab_visibility, saves_count, short_description, skills, slug, solution_statement, stage_completion_dates, status, status_emoji, status_expires_at, status_set_at, status_set_by, status_text, sync_status, tags, title, updated_at, view_count, visibility) ON public.projects TO authenticated;
--> statement-breakpoint
CREATE VIEW public.project_members WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, user_id, role, joined_at, file_upload_enabled, notification_preferences, title, show_on_profile, last_seen_updates_at, unit_id FROM public.workspace_members;
--> statement-breakpoint
COMMENT ON VIEW public.project_members IS 'Old name of workspace_members (0264). Drop after one release.';
--> statement-breakpoint
GRANT SELECT ON public.project_members TO anon;
--> statement-breakpoint
GRANT SELECT ON public.project_members TO authenticated;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_members TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_members TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_invitations WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, inviter_id, candidate_id, kind, role_id, role_title, guidance_label, note, project_title, status, expires_at, review_at, idempotency_key, resolved_at, resolved_by, created_at, updated_at FROM public.workspace_invitations;
--> statement-breakpoint
COMMENT ON VIEW public.project_invitations IS 'Old name of workspace_invitations (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_invitations TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_invitations TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_guidance_appointments WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, guide_user_id, invitation_id, label, status, review_at, public_attribution_consent, previous_membership_role, accepted_at, ended_at, ended_by, end_reason, created_at, updated_at FROM public.workspace_mentors;
--> statement-breakpoint
COMMENT ON VIEW public.project_guidance_appointments IS 'Old name of workspace_mentors (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_guidance_appointments TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_guidance_appointments TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_open_roles WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, role, title, description, count, filled, created_at, updated_at, skills, commitment_type, experience_required, hours_per_week, team_lead_user_id AS lead_user_id FROM public.workspace_open_roles;
--> statement-breakpoint
COMMENT ON VIEW public.project_open_roles IS 'Old name of workspace_open_roles (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_open_roles TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_open_roles TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_follows WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, user_id, created_at FROM public.workspace_follows;
--> statement-breakpoint
COMMENT ON VIEW public.project_follows IS 'Old name of workspace_follows (0264). Drop after one release.';
--> statement-breakpoint
GRANT SELECT ON public.project_follows TO anon;
--> statement-breakpoint
GRANT SELECT ON public.project_follows TO authenticated;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_follows TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_follows TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_skills WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, skill_id, created_at, usage_kind, display_order, evidence, updated_at FROM public.workspace_skills;
--> statement-breakpoint
COMMENT ON VIEW public.project_skills IS 'Old name of workspace_skills (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_skills TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_skills TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_tags WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, tag_id, created_at FROM public.workspace_tags;
--> statement-breakpoint
COMMENT ON VIEW public.project_tags IS 'Old name of workspace_tags (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_tags TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_tags TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_docs WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, published_version_id, settings, created_at, updated_at, linked_node_id, filename, slug FROM public.workspace_documents;
--> statement-breakpoint
COMMENT ON VIEW public.project_docs IS 'Old name of workspace_documents (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_docs TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_docs TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_doc_versions WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, version_number, content, excerpt, headings, quality_report, content_hash, change_summary, created_by, created_at, deleted_at, co_authors, doc_id FROM public.workspace_document_versions;
--> statement-breakpoint
COMMENT ON VIEW public.project_doc_versions IS 'Old name of workspace_document_versions (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_doc_versions TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_doc_versions TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_updates WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, author_id, content, update_type, visibility, reply_policy, entity_refs, media, metadata, is_pinned, like_count, comment_count, deleted_by, edited_at, deleted_at, created_at, updated_at, audience, notify_level, pinned_until, shared_to_org_at FROM public.workspace_updates;
--> statement-breakpoint
COMMENT ON VIEW public.project_updates IS 'Old name of workspace_updates (0264). Drop after one release.';
--> statement-breakpoint
GRANT SELECT ON public.project_updates TO anon;
--> statement-breakpoint
GRANT SELECT ON public.project_updates TO authenticated;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_updates TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_updates TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_update_comments WITH (security_invoker = true) AS SELECT id, update_id, workspace_id AS project_id, user_id, content, deleted_by, deleted_at, created_at, updated_at, parent_id, target_user_id FROM public.workspace_update_comments;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_comments IS 'Old name of workspace_update_comments (0264). Drop after one release.';
--> statement-breakpoint
GRANT SELECT ON public.project_update_comments TO anon;
--> statement-breakpoint
GRANT SELECT ON public.project_update_comments TO authenticated;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_comments TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_comments TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_update_likes WITH (security_invoker = true) AS SELECT id, update_id, user_id, created_at FROM public.workspace_update_likes;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_likes IS 'Old name of workspace_update_likes (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_likes TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_likes TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_update_media_assets WITH (security_invoker = true) AS SELECT id, update_id, asset_id, ordinal, created_at FROM public.workspace_update_media_assets;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_media_assets IS 'Old name of workspace_update_media_assets (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_media_assets TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_media_assets TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_update_drafts WITH (security_invoker = true) AS SELECT workspace_id AS project_id, user_id, content, visibility, update_type, entity_refs, media, updated_at FROM public.workspace_update_drafts;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_drafts IS 'Old name of workspace_update_drafts (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_drafts TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_drafts TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_update_draft_media_assets WITH (security_invoker = true) AS SELECT workspace_id AS project_id, user_id, asset_id, ordinal, created_at FROM public.workspace_update_draft_media_assets;
--> statement-breakpoint
COMMENT ON VIEW public.project_update_draft_media_assets IS 'Old name of workspace_update_draft_media_assets (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_draft_media_assets TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_update_draft_media_assets TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_sprints WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, name, goal, start_date, end_date, status, created_at, updated_at, description, creator_id, sprint_number, started_at, completed_at, archived_at, cancelled_at, parent_sprint_id, auto_start, show_in_children, notify_on_start FROM public.workspace_sprints;
--> statement-breakpoint
COMMENT ON VIEW public.project_sprints IS 'Old name of workspace_sprints (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_sprints TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_sprints TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_sprint_events WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, sprint_id, actor_id, event_type, payload, created_at FROM public.workspace_sprint_events;
--> statement-breakpoint
COMMENT ON VIEW public.project_sprint_events IS 'Old name of workspace_sprint_events (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_sprint_events TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_sprint_events TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_workflow_columns WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, status, title, accent_class_name, empty_title, empty_description, position, is_default, created_at, updated_at FROM public.workspace_workflow_columns;
--> statement-breakpoint
COMMENT ON VIEW public.project_workflow_columns IS 'Old name of workspace_workflow_columns (0264). Drop after one release.';
--> statement-breakpoint
GRANT SELECT ON public.project_workflow_columns TO anon;
--> statement-breakpoint
GRANT SELECT ON public.project_workflow_columns TO authenticated;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_workflow_columns TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_workflow_columns TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_task_policy_events WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, actor_id, review_required, policy_version, created_at FROM public.workspace_task_policy_events;
--> statement-breakpoint
COMMENT ON VIEW public.project_task_policy_events IS 'Old name of workspace_task_policy_events (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_task_policy_events TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_task_policy_events TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_nodes WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, parent_id, type, name, s3_key, size, mime_type, metadata, created_by, created_at, updated_at, deleted_by, deleted_at, git_blob_hash, path, current_version, task_id, canonical_node_id, last_synced_commit_sha, sync_status, asset_id FROM public.workspace_nodes;
--> statement-breakpoint
COMMENT ON VIEW public.project_nodes IS 'Old name of workspace_nodes (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_nodes TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_nodes TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_node_events WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, node_id, actor_id, type, metadata, created_at, sequence_number FROM public.workspace_node_events;
--> statement-breakpoint
COMMENT ON VIEW public.project_node_events IS 'Old name of workspace_node_events (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_node_events TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_node_events TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_node_locks WITH (security_invoker = true) AS SELECT node_id, workspace_id AS project_id, locked_by, acquired_at, expires_at, session_id, lease_id, client_kind, device_session_id, fencing_token, renewed_at FROM public.workspace_node_locks;
--> statement-breakpoint
COMMENT ON VIEW public.project_node_locks IS 'Old name of workspace_node_locks (0264). Drop after one release.';
--> statement-breakpoint
GRANT SELECT ON public.project_node_locks TO anon;
--> statement-breakpoint
GRANT SELECT ON public.project_node_locks TO authenticated;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_node_locks TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_node_locks TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_node_conflicts WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, node_id, task_id, git_branch, canonical_content, incoming_content, merged_content, conflict_status, created_at FROM public.workspace_node_conflicts;
--> statement-breakpoint
COMMENT ON VIEW public.project_node_conflicts IS 'Old name of workspace_node_conflicts (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_node_conflicts TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_node_conflicts TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_file_index WITH (security_invoker = true) AS SELECT node_id, workspace_id AS project_id, content, updated_at FROM public.workspace_file_index;
--> statement-breakpoint
COMMENT ON VIEW public.project_file_index IS 'Old name of workspace_file_index (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_file_index TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_file_index TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_git_deltas WITH (security_invoker = true) AS SELECT id, workspace_id AS project_id, task_id, target_branch, sequence_number, delta_order, action, node_id, path, old_path, git_blob_hash, file_version_id, s3_key, status, job_id, processed_commit_sha, processing_error, processed_at, created_at FROM public.workspace_git_deltas;
--> statement-breakpoint
COMMENT ON VIEW public.project_git_deltas IS 'Old name of workspace_git_deltas (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_git_deltas TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_git_deltas TO service_role;
--> statement-breakpoint
CREATE VIEW public.project_event_counters WITH (security_invoker = true) AS SELECT workspace_id AS project_id, next_sequence, updated_at FROM public.workspace_event_counters;
--> statement-breakpoint
COMMENT ON VIEW public.project_event_counters IS 'Old name of workspace_event_counters (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_event_counters TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.project_event_counters TO service_role;
--> statement-breakpoint
CREATE VIEW public.profile_project_contributions WITH (security_invoker = true) AS SELECT id, profile_id, workspace_id AS project_id, source, role_kind, role_title, summary, skills, started_at, ended_at, verified_at, verified_by, visibility, created_at, updated_at, deleted_at, external_key, project_title, project_url, repository_url, version, presentation, featured, published_at, verification_revoked_reason, show_work_record FROM public.profile_contributions;
--> statement-breakpoint
COMMENT ON VIEW public.profile_project_contributions IS 'Old name of profile_contributions (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.profile_project_contributions TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.profile_project_contributions TO service_role;
--> statement-breakpoint
CREATE VIEW public.profile_project_contribution_stages WITH (security_invoker = true) AS SELECT id, contribution_id, profile_id, workspace_id AS project_id, source, role_kind, role_title, summary, skills, started_at, ended_at, verified_at, verified_by, event_id, visibility, manual_override, display_order, created_at, updated_at, deleted_at FROM public.profile_contribution_stages;
--> statement-breakpoint
COMMENT ON VIEW public.profile_project_contribution_stages IS 'Old name of profile_contribution_stages (0264). Drop after one release.';
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.profile_project_contribution_stages TO postgres;
--> statement-breakpoint
GRANT DELETE, INSERT, SELECT, UPDATE ON public.profile_project_contribution_stages TO service_role;
--> statement-breakpoint
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_id, 'owner' FROM public.workspaces w
WHERE w.owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = w.owner_id)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';
--> statement-breakpoint
UPDATE public.workspace_members m SET role = 'admin'
FROM public.workspaces w WHERE w.id = m.workspace_id AND m.role = 'owner' AND m.user_id IS DISTINCT FROM w.owner_id;
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_members_one_owner ON public.workspace_members (workspace_id) WHERE role = 'owner';
--> statement-breakpoint
CREATE FUNCTION public.workspace_members_sync_owner() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.workspaces SET owner_id = NEW.user_id, updated_at = now()
  WHERE id = NEW.workspace_id AND owner_id IS DISTINCT FROM NEW.user_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.workspace_members_sync_owner() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER workspace_members_sync_owner AFTER INSERT OR UPDATE OF role ON public.workspace_members
FOR EACH ROW WHEN (NEW.role = 'owner') EXECUTE FUNCTION public.workspace_members_sync_owner();
