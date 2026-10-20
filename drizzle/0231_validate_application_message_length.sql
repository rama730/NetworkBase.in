-- 0227 added role_applications_message_length_check as NOT VALID, so it only guarded new and edited rows.
-- Validate it now, but only if no existing application message is over the limit: this migration never edits or
-- truncates anyone's text, and it never fails the rollout. Over-long messages (if any) keep the constraint
-- unvalidated until they are dealt with.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.role_applications WHERE char_length(message) > 2000) THEN
    RAISE NOTICE 'role_applications_message_length_check left NOT VALID: some messages are longer than 2000 characters';
  ELSE
    ALTER TABLE public.role_applications VALIDATE CONSTRAINT role_applications_message_length_check;
  END IF;
END
$$;
