-- Plan B7.2c (report 36.3 call 10): the handover checklist sits on the outgoing officer's term: which of the five items
-- are done (role page updated, open tasks moved, documents moved, accounts listed, the Handover meeting). Server only.
ALTER TABLE public.club_position_terms ADD COLUMN handover jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE public.club_position_terms ADD CONSTRAINT club_position_terms_handover CHECK (jsonb_typeof(handover) = 'object');
