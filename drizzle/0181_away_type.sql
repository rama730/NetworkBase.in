-- Plan B4.2c (report 33.3 call 5): time off reuses Away with a type (Vacation · Sick · Out of office · Other). Others
-- see only "Away until …"; the type reaches the person, their line manager and admins. Old rows keep a null type.

ALTER TABLE public.org_member_away ADD COLUMN IF NOT EXISTS type text;
--> statement-breakpoint
ALTER TABLE public.org_member_away ADD CONSTRAINT org_member_away_type_check CHECK (type IS NULL OR type IN ('vacation', 'sick', 'ooo', 'other'));
