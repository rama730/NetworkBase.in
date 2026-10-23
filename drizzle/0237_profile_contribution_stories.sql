-- Published presentation is separate from private drafts and immutable membership history.
ALTER TABLE public.profile_project_contributions ADD COLUMN IF NOT EXISTS presentation jsonb;
ALTER TABLE public.profile_project_contributions ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.profile_project_contributions ADD COLUMN IF NOT EXISTS published_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profile_contribution_presentation_size') THEN
    ALTER TABLE public.profile_project_contributions ADD CONSTRAINT profile_contribution_presentation_size CHECK (presentation IS NULL OR octet_length(presentation::text) <= 150000);
  END IF;
END $$;

CREATE TABLE public.profile_contribution_drafts (
  contribution_id uuid PRIMARY KEY REFERENCES public.profile_project_contributions(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document jsonb NOT NULL CHECK (octet_length(document::text) <= 150000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_contribution_drafts_profile_idx ON public.profile_contribution_drafts(profile_id);
ALTER TABLE public.profile_contribution_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contribution_drafts_owner ON public.profile_contribution_drafts FOR ALL TO authenticated
  USING (profile_id = (SELECT auth.uid())) WITH CHECK (profile_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.profile_project_contributions c WHERE c.id=contribution_id AND c.profile_id=(SELECT auth.uid())
  ));

CREATE TABLE public.profile_contribution_media_assets (
  contribution_id uuid NOT NULL REFERENCES public.profile_project_contributions(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.storage_assets(id),
  PRIMARY KEY (contribution_id, asset_id)
);
CREATE INDEX profile_contribution_media_assets_asset_idx ON public.profile_contribution_media_assets(asset_id);
ALTER TABLE public.profile_contribution_media_assets ENABLE ROW LEVEL SECURITY;
-- No direct public policy: application delivery rechecks publication, project and profile access.
CREATE POLICY contribution_media_owner ON public.profile_contribution_media_assets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profile_project_contributions c WHERE c.id=contribution_id AND c.profile_id=(SELECT auth.uid())));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('contribution-images','contribution-images',false,10485760,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;
-- Only signed uploads from authenticated application actions; no direct object-read policy.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profile_contribution_drafts,public.profile_contribution_media_assets TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.profile_contribution_drafts,public.profile_contribution_media_assets TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON public.profile_contribution_drafts,public.profile_contribution_media_assets TO service_role;
  END IF;
END $$;
UPDATE public.profile_collaboration_summaries SET stale=true,updated_at=now();

CREATE UNIQUE INDEX IF NOT EXISTS profile_audit_events_story_request_unique
  ON public.profile_audit_events(user_id, (metadata->>'requestId'))
  WHERE event_type='contribution_story_saved';
