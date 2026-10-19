# Main Settings open sections — 16 October 2026

Implemented the approved Edit Profile presentation across the main Settings document: Account, Security, Privacy, Notifications, Appearance, Integrations, Legal and data rights, and Delete account.

- Content width now matches Edit Profile's `max-w-4xl` (896px) with the existing shared sidebar width and density-aware page insets.
- Main section headers no longer have their own divider directly underneath. Their titles and descriptions lead into content with the same 32px spacing as Edit Profile.
- Subsections use plain headings, descriptions, 16px content gaps, bottom hairlines with 24px spacing, and 32px separation. Removed outer rounded card frames, header/body split borders, and inset card padding from this main-page presentation.
- Appearance no longer adds an extra embedded-page bottom gap. The optional manual-token form also opens directly into the main layout instead of nesting another card.
- Route loading and Security, Privacy, Notifications, and Appearance loading states use open section skeletons rather than large boxed card placeholders.
- Buttons, inputs, choice controls, warnings, consent panels, identities and dialogs retain their shapes and behavior. No settings mutations, permissions, sign-out/deletion flows or navigation handling were changed.

`OpenSettingsSections` scopes this presentation to the main Settings document. `SettingsSectionCard` retains its previous card output outside that scope, including the legal/data-rights component embedded in project settings. No global CSS or common dialog primitive was changed.

Validation performed through code and command-line tooling only:

- TypeScript and ESLint pass for the 11 changed implementation files.
- All 15 existing focused settings/legal checks pass.
- Server rendering confirms open sections and skeletons have no outer card frame or inset card padding, action controls still render, and the default card presentation remains unchanged after an open-layout render.
- All 130 protected Messages source files match the saved pre-change hashes.
- Whitespace checks pass. No browser or runtime visual inspection was used.
