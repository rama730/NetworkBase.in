# Existing test failures

The post-redesign full run has 24 failing test cases. The list below also includes failed parent suites. Every listed failure was present in the baseline; the redesign does not have a clean release-gate result.

- Files workspace scroll panes drive the project header state
- GitHub Card Redesign & Integrations Settings Contract
- IntegrationsSettings eliminates the 404 /projects link and provides inline expansion
- SQL audit query remediations
- approval clears review state without changing file ownership or roles
- background writers defer instead of overwriting active editors
- bounds Git storage writes and persists only confirmed uploads
- bounds workspace pages and consolidates project task aggregates
- composer uploads attachments through the authenticated server action
- files search, navigation, versions, trash, and pagination share owned paths
- hard-delete retries Auth finalization and removes retained identity
- historical message videos wait for explicit viewer intent
- identity presentation
- integrations settings shows extension app identity before sessions
- message reactions remain compact, accessible, and anchored to the bubble edge
- message receipt buffering is debounced, session-deduplicated, and never flushes during teardown
- messages workspace gates chat-only runtime work by active tab
- normalizes camelCase and snake_case identity fields
- only exposes close-out once an active sprint reaches its scheduled end
- presence is chat-scoped and debounce markers follow persistence
- private Realtime is fail-closed until database authorization is promoted
- project update file mentions survive the dashboard and Files V3 handoff
- reaction activity is separate from messages and remains recipient-specific
- sprint permissions and summary
- the global runtime owns participant subscriptions while the inbox reuses them
- thread cache hydration never replaces full messages with inbox previews
- workflow columns keep four default categories while allowing two project-specific sections
- workspace task handoff opens the task panel without leaking drawer IDs into the URL

The global-search contract separately reports the pre-existing missing `tasks_project_idx` schema expectation. These failures require owning-feature review; behavioral assertions were retained.
