# GitHub Sync sign-in: existing identity rejected as a new link

The reported return URL contains `error_code=identity_already_exists`; this is an identity conflict, not a cancellation.

## Cause

`createClient().auth.getUser()` resolves the verified lightweight auth snapshot. `buildUserFromSnapshot()` deliberately sets `identities: []`. The sync state passed that snapshot directly to `buildGithubAccountConnectionState`, which correctly requires a real identity record. Consequently the UI chose `linkIdentity` even when GitHub was already linked. Repository-picker token validation also lacked the current identity records. Separately, the callback classified every provider failure other than `access_denied` as `cancelled`, and the workspace ignored provider errors appended in the URL fragment.

## Correction

- Sync state, repository browsing and import access now load current identity records scoped to the authenticated user through one server helper. An empty current result remains empty; lookup failures stay errors. JWT metadata is not used to invent a link.
- Before starting Sync authorization, the browser rechecks its current identities with Supabase. Linked GitHub accounts renew repository authorization; only an authoritative absent GitHub identity enters linking. Cancellation and superseded attempts remain guarded.
- The callback preserves actionable error codes. The workspace reads query and fragment errors, gives an identity conflict specific guidance, and removes consumed OAuth errors before retrying. Success/replacement markers and ordinary navigation anchors are preserved.
- Existing session/account-mismatch checks, requested repository scopes and explicit transfer confirmation are unchanged. No identities are detached or moved between accounts automatically.

## Code-only validation

203 GitHub-related tests passed, including regressions for omitted snapshot identities, current unlink state, failed lookups, correct link/renew routing, cancellation, and the screenshot's exact fragment overriding a misleading cancellation query. The URL-cleanup regression was rerun after adding preservation of Settings success markers. TypeScript and scoped ESLint passed. No browser monitoring, live OAuth, publication or database mutation was performed for this fix.

Reload the Files tab and retry Connect GitHub/Renew GitHub access. An identity genuinely owned by another NetworkBase account still requires using that account or choosing a different GitHub identity; the application must not silently transfer it.
