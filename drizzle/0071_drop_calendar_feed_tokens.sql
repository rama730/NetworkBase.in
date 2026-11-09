-- 2026-11-09: the calendar feed is removed (the Sprints view's Calendar button, its private .ics link and the feed).
-- Its tokens open nothing once the route is gone, so the table goes too.
DROP TABLE IF EXISTS public.calendar_feed_tokens;
