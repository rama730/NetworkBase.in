-- Report G16 (M5): a change set keeps a file's executable bit (scripts, bin/). Null: not known, leave as it is.
ALTER TABLE public.change_set_items ADD COLUMN IF NOT EXISTS executable boolean;
