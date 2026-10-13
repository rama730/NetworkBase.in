-- 0216: give every task in a board column a distinct position.
-- Tasks created before positions were assigned at insert have NULL (read as 0), so dropping a card
-- between two of them computed the same midpoint and did nothing. Only columns holding NULL or
-- duplicate positions are rewritten, and the board order is kept exactly: the server sorts
-- position DESC, then created_at DESC, then id DESC, so ranking ascending on the same keys and
-- spacing by 1024 reproduces it with room for later drops. updated_at is left alone on purpose:
-- a background renumbering is not an edit, and open boards keep their version checks.
WITH affected AS (
  SELECT workflow_column_id
  FROM public.tasks
  WHERE deleted_at IS NULL AND workflow_column_id IS NOT NULL
  GROUP BY workflow_column_id
  HAVING bool_or(position IS NULL) OR count(*) <> count(DISTINCT position)
),
ranked AS (
  SELECT t.id,
         row_number() OVER (
           PARTITION BY t.workflow_column_id
           ORDER BY COALESCE(t.position, 0), t.created_at, t.id
         ) * 1024 AS next_position
  FROM public.tasks t
  JOIN affected a ON a.workflow_column_id = t.workflow_column_id
  WHERE t.deleted_at IS NULL
)
UPDATE public.tasks t
SET position = ranked.next_position
FROM ranked
WHERE t.id = ranked.id;
