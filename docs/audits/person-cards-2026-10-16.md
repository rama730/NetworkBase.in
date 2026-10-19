# Person-card implementation — 16 October 2026

The approved prototype is implemented through PersonCardContent / PersonCardLayout, shared by Network suggestions, connections, incoming/sent connection requests, project invitations and applications, and both Discover rail presentations. Existing navigation, messaging, page shells, rail scrolling and mutation services are retained.

## Presentation and data

- 176px outer boundary; 20px wide/16px compact inset; squared avatars and skill-tag pill outlines shared with Discover project cards. Name-adjacent saved collaboration, 13px headline, 12px mono map-pin location, darker medium Portfolio label. Sparse middle rows collapse; full details remain accessible through navigation or dialogs.
- Fit up to four canonical declared skills into the actual row width; reserve an accurate +N button. Pointer/touch/keyboard disclosures and focus restoration use existing Radix dialogs. Only font/width/content changes measure the strip; there is no new polling or minute-based date update.
- Connection and date context follows skills. Exact shared counts remain accessible while display wording shortens only when needed. Shared-person identities load only on demand, in 20-person pages, with target access checks before and after reading. Optional metadata failure preserves authorized base content and omits unverifiable fields.
- A single bounded page batch uses canonical public skill edges and published profile contributions (including external/historical work), current public project visibility, and distinct visible accepted peers. Private/viewer/draft/deleted work is excluded. Blocked/deleted identities are removed; locked profiles retain only permitted identity presentation.
- Migration 0219 adds nullable accepted_at and a database transition trigger covering every writer, including bulk acceptance. Later updates cannot change acceptance time; ending/restarting a relationship clears/captures its new value. Historical accepted rows stay unknown rather than inheriting updated_at.
- Review modals retain failed/offline decisions with inline feedback. Success is shown only after confirmation; existing pending-request rollback, undo, permission checks, confirmation dialogs and message entry points are retained.

## Verification

- Production webpack build, TypeScript and targeted ESLint passed.
- Eight focused unit checks passed, including existing feed/bounds contracts. Broader person-card, avatar, skills, top-nav and canonical-owner regression coverage: 44 checks passed; one existing project OG-cache source assertion still expects inline s-maxage=3600 in the old route implementation and fails against the pre-existing shared-image delegate. That route was not changed by this task.
- Six PostgreSQL integration checks on an isolated local database at port 54349, covering public/private portfolio and skill edges, true mutual counts, acceptance immutability and existing paging/suggestion behavior.
- Ten new Chromium/WebKit browser tests exercising real components: scenario/width/theme/variant matrices, skill fitting, shared pagination, focus, error rollback, all five invitation/application card types and compact touch actions.
- Existing rail/page regression coverage: 34 checks passed unchanged; the two old placement/growing-height expectations were updated to the newly approved geometry and passed on Chromium/WebKit.
- Query-key, canonical-logic and impact-review contracts pass. Avatar governance now also checks the shared PersonCardContent owner and its delegating surfaces, with a regression that rejects a noncanonical shared owner. The repository migration-journal and SQL-governance checks report a pre-existing unregistered file, 0216_project_members_user_role_idx.sql; this work does not register or execute that unrelated migration.

## Deployment

Migration 0219 was tested against the isolated database, then applied alone to the configured application database under the existing migration advisory lock. Its checksum/index were recorded in the application migration journal. The nullable column, transition trigger and completed journal status were verified. Previous 0218 lineage was checked before applying; unrelated pending migrations were not executed. No historical connection dates were backfilled. Application code has not been deployed by this task.

## Skill rendering correction

The reported connected profiles had five saved profile skill labels each and no profile_skills assignments. The new projection had replaced their legacy skill lists with empty canonical results. The bounded reader now uses the existing saved list only when there are no assignments at all; any assignment, including private or hidden ones, keeps canonical visibility authoritative. Labels are canonicalized and deduplicated before rendering. A read-only verification through the actual reader returned all five saved skills for both reported profiles. No profile data or assignments were rewritten.

The shared strip and full-list dialog now use the existing SkillIcon and shared catalog subscription. Fourteen-pixel icons participate in width fitting, keeping the card at 176px and reserving an accurate +N disclosure. Matched tags use the icon's current-color mode for contrast. Regression coverage includes the real Network connections feed, legacy fallback, explicit canonical privacy, loaded catalog icons and complete skill disclosure.

Correction verification: TypeScript, scoped ESLint, 14 unit checks and seven disposable database checks pass. Ten existing component browser checks pass with icons enabled; the two new complete-list/icon checks also pass after aligning their expected label with canonical “Design Systems” casing. Impact review and scoped whitespace checks pass.

## Relationship date labels — 2026-10-17

Connections retain month/year acceptance labels. A read-only check found that all three existing accepted relationships lack accepted_at and have no corresponding acceptance notification. Per the approved fallback, those cards now display the original request month/year as “Request sent · Dec 2025” (compact: “Requested · Dec 2025”), with a tooltip identifying the unavailable acceptance date. The request timestamp is passed separately; accepted_at is never overwritten or inferred from it. Valid acceptance timestamps take precedence. Both missing/invalid dates still fall back to “Connected.”

Invitation footers now include day, abbreviated month and year in both full and compact layouts, such as “Requested · 14 May 2026.” UTC formatting keeps server/client dates consistent. Card geometry and Messages remain unchanged. TypeScript, scoped ESLint and ten focused unit checks pass, including acceptance precedence, legacy request fallback, invalid dates and UTC month/year boundaries. No browser monitoring or database writes were used for this correction.
