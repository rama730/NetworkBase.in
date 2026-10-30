-- Nothing anonymous reads notifications. connections stays granted: profiles_select_visible reads it as the caller.
REVOKE SELECT ON public.user_notifications FROM anon;
