-- 0262: browser roles never write or read story drafts and media directly; the server does (0237 granted them by
-- mistake). The connection-pair trigger function isn't callable from the browser either. Triggers still fire.
REVOKE ALL ON public.profile_contribution_drafts, public.profile_contribution_media_assets FROM anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.prevent_connection_pair_mutation() FROM PUBLIC, anon, authenticated;
