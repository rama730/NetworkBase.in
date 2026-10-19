-- Durable extension operation lookups must remain bounded after Redis replay keys expire.
CREATE INDEX IF NOT EXISTS project_node_events_operation_idx
ON project_node_events (project_id, actor_id, (metadata->>'operationId'));
