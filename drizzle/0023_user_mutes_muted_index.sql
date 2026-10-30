-- Deleting an account checks user_mutes.muted_id through its foreign key; the primary key leads on muter_id, so this needs its own index.
CREATE INDEX user_mutes_muted_idx ON public.user_mutes USING btree (muted_id);
