# NetworkBase profile typography audit

**Audit date:** 2026-09-10  
**Repository:** `/Users/chrama/Downloads/nb-s3`  
**Specification:** `docs/design/networkbase-application-design-specification.html`  
**Method:** static source audit and supplied-screenshot comparison  
**Implementation status:** completed after the static audit; verified from source without browser automation

## Conclusion

The profile typography is now **conformant with the NetworkBase type contract**. The profile name uses the responsive 30px page-title role, Portfolio and edit-panel titles use the 20px section role, card and editor subsection headings use 17px, narrative content and entered values use 15px, controls and compact descriptions use 13px, metadata uses 12px mono text, and state labels use 11px mono micro text. The right-rail headings shown in the supplied screenshot now share the same 17px treatment as `Open to Roles`, `About`, and `Project Contributions`.

The static inventory covered the owner profile, public profile, Overview, Portfolio, right rail, profile edit dialog, connections dialog, invite entry point, and fallback states. The implementation binds those surfaces to the existing named roles instead of adding another type scale.

## Remediation completed

- Unified all card and right-rail headings on `nb-card-title` and normalized their leading icons to 18px.
- Moved the identity name and username to `nb-page-title` and `nb-meta`, restoring the required line metrics and mobile title reduction.
- Promoted edit-profile subsection headings to 17px and primary edit-panel headings to 20px.
- Normalized field labels and controls to 13px while keeping input, textarea, and select values at 15px.
- Restored full-sentence card copy to 15px and compact helper copy to 13px.
- Applied the mono metadata role to handles, counts, dates, link accounts, completion state, and save state.
- Applied the micro role to contribution privacy/save states and link-health states.
- Added a focused source contract test covering the page title, cards, tabs, metadata, editor hierarchy, and form roles.

## Governing type contract

| Role | Required typography |
|---|---|
| Page title | Instrument Sans, 30px/1.28, weight 600, `-0.015em` tracking; 24px on narrow mobile layouts |
| Section title | Instrument Sans, 20px/1.28, weight 600 |
| Card/subsection title | Instrument Sans, 17px/1.28, weight 600, `-0.01em` tracking |
| Body | Instrument Sans, 15px/1.5 |
| Compact copy | Instrument Sans, 13px/1.5 |
| UI label/control | Instrument Sans, 13px/1.2, weight 500 |
| Metadata | JetBrains Mono, 12px/1.35, tabular numerals |
| Micro label | JetBrains Mono, 11px/1.2, uppercase, `0.09em` tracking |

These roles are already encoded in `src/app/globals.css` as `nb-page-title`, `nb-section-title`, `nb-card-title`, `nb-body`, `nb-compact`, `nb-ui-label`, `nb-meta`, and `nb-micro`. The global Tailwind scale also maps `text-xs` to 12px, `text-sm` to 13px, `text-base` to 15px, `text-lg` to 17px, and `text-xl` to 20px.

## Prioritized findings

### P1 — The right rail uses a UI-label size for card headings

`src/components/profile/v2/ProfileRightRail.tsx:31-35` defines a second card-header implementation and renders its `h2` with `text-sm`, which resolves to 13px. This affects `Links`, `Profile Completeness`, and `Shortcuts` at lines 67, 119, and 155. In the same rail, `OpenToRolesCard` uses the shared `Card` component, whose heading is correctly rendered through `nb-card-title` at 17px.

**Effect:** adjacent cards at the same hierarchy have visibly different title sizes, exactly as the screenshot shows.

**Required correction:** make `RailCard` reuse the shared `Card` header or apply `nb-card-title`. Keep link/button labels at 13px and account metadata at 12px.

### P1 — The profile identity title has the right size but the wrong metrics and responsive behavior

`src/components/profile/v2/ProfileHeader.tsx:233` hard-codes 30px with line-height `1.2` and tracking `-0.02em`. The specification requires 30px/1.28 with `-0.015em`. Because the heading does not use `nb-page-title`, it also misses the existing mobile rule that reduces page titles to 24px below 640px.

`src/components/profile/v2/ProfileHeader.tsx:235` starts with `nb-meta` but overrides its 12px size with 13px. The username remains mono, but it no longer matches the metadata role used by location, connections, and project count.

**Required correction:** use `nb-page-title` for the name and unmodified `nb-meta` for the username. This fixes desktop metrics and mobile scaling with one shared contract.

### P1 — Edit-profile subsection headings collapse into body/UI text

The dialog-level hierarchy is correct: `DialogTitle` is 17px and each primary edit section uses a 20px `h2` at `src/components/profile/edit/EditProfileTabs.tsx:161`, `:312`, `:329`, `:337`, and `:346`. Several nested sections then drop too far:

- `Profile Photo` is 15px at line 178.
- `Your contributions` is 13px at line 627.
- `Your public links` is 13px at line 890.
- `Add a link` / `Edit link` is 13px at line 917.
- the empty contribution title is 13px at line 641.

These labels introduce a distinct subsection or card and should use the 17px card/subsection-title role. Their descriptions can remain 13px compact copy.

**Required correction:** give nested editor sections a shared 17px heading component or class rather than relying on local `text-base`/`text-sm` declarations.

### P2 — Form labels and entered text do not use stable roles

The shared `Input` primitive correctly renders entered text at 15px. The raw textareas and selects in the profile editor override that contract:

- Bio textarea: 13px at `src/components/profile/edit/EditProfileTabs.tsx:273`.
- Contribution summary textarea: 13px at line 759.
- Experience and weekly-capacity selects: 13px at lines 508 and 519.

Labels also vary between explicit 13px UI text (`Full Name`, `Username`, `Headline`, `Bio`) and inherited 15px body text (`Location`, `Website`, role-category labels, and contribution form labels around lines 280, 292, 415, 440, 465, and 721-758).

**Effect:** controls in the same form can show different input sizes, and some labels compete with entered values.

**Required correction:** use 13px/1.2 for every field label and 15px/1.5 for every input, textarea, and select value. Apply the shared input/control primitives where possible.

### P2 — Narrative card copy is sometimes reduced to UI size

`src/components/profile/v2/sections/AboutCard.tsx:33-35` correctly inherits 15px body text for a populated bio. By contrast, the empty role-preference explanation in `OpenToRolesCard.tsx:99-101` and the empty right-rail message in `ProfileRightRail.tsx:102-114` are rendered at 13px.

Short descriptions beneath a section heading may use the 13px compact role, but full-sentence explanatory copy inside a card should use 15px body typography. Actions such as `Set role preferences` and `Add your first link` should remain 13px UI labels.

### P2 — Several 12px values have the correct size but the wrong font role

The profile specification uses JetBrains Mono for dates, counts, handles, and compact system metadata. The following values are 12px but remain in Instrument Sans:

- right-rail social account labels at `src/components/profile/v2/ProfileRightRail.tsx:83`;
- contribution file counts, privacy state, and dates at `src/components/profile/v2/sections/ProjectContributionsCard.tsx:102`, `:123`, `:130`, and `:155`;
- connection headlines in `src/components/profile/v2/UserConnectionsModal.tsx:205` where the text is descriptive copy rather than metadata and should instead use 13px compact sans.

**Required correction:** apply `nb-meta` to true handles/counts/dates, and use `nb-compact` for descriptive subtitles.

### P3 — Small profile statuses do not share one text role

Profile skills correctly use the 12px `nb-tag` contract, and the main availability badge uses the shared status style. Other pills and state labels use ad hoc 12px sans text, including role-preference pills, link-health actions, contribution privacy states, and editor chips.

The sizes are allowed, but the semantics vary. A profile-wide badge rule should choose either 11px mono micro text for state labels or 12px compact tag text for user-provided values, then apply that distinction consistently.

## Conformant areas to preserve

- `src/components/profile/v2/sections/Card.tsx:31-42` uses 20px insets and the 17px `nb-card-title` role for About, Open to Roles, and Project Contributions.
- `src/components/profile/v2/sections/AboutCard.tsx:33-35` uses the inherited 15px body size and readable line height for the biography.
- `src/components/profile/v2/ProfileTabs.tsx:58` uses the 13px UI role for Overview and Portfolio.
- `src/components/profile/v2/sections/ProjectsGridCard.tsx:57-79` uses a 20px Portfolio heading and 13px compact description, then reuses the same `ProjectCard` component as Discovery. Project-card titles and metadata therefore inherit the shared 17px/12px contract.
- `src/components/profile/v2/ProfileHeader.tsx:246` uses `nb-body` for the headline, and lines 255-297 correctly use `nb-meta` for location, counts, and the website link.
- Profile actions use the 13px UI size, and the shared dialog, button, input, card, tabs, tooltip, and empty-state primitives use the approved scale.
- Owner and public profile routes both render `ProfileV2Client`, so repairing the shared profile components will keep `/profile` and `/u/[username]` consistent.
- No authored profile text is below 11px, and no profile-specific literal font size falls outside the approved scale.

## Recommended implementation order

1. Replace the duplicate right-rail heading with the shared 17px card-header contract.
2. Move the identity name and username to `nb-page-title` and `nb-meta`.
3. Add one 17px editor-subsection heading role and apply it to all edit sections.
4. Normalize editor labels to 13px and entered values to 15px.
5. Normalize narrative copy and true metadata roles.
6. Add a focused static contract test that checks the profile name, shared card headings, right-rail headings, tabs, metadata, and editor controls against the named typography utilities.

## Audit disposition

All identified typography findings have been implemented. The remaining literal size uses in profile source are avatar initials, where the type size is visual content inside a fixed avatar rather than interface hierarchy. Static contracts guard the semantic roles used by the public profile and editor.
