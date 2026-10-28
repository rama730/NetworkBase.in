# Settings copy glossary

One set of words for the Settings document. Prefer these; they match the nav, the section headings, search and the user menu.

## Section names (the same everywhere)

Account · Security · Privacy · Notifications · Appearance · Integrations · Legal and data · Delete account

## Words

| Say | Not |
|---|---|
| Sign out / signed out | log out, logged out |
| Sign-in method | login provider, identity, connection (say "Google", "GitHub", "email and password") |
| Connect / Disconnect | Link / Unlink (for Google and GitHub) |
| Authenticator app | MFA, 2FA, TOTP (in sentences people read) |
| Editor token | manual token, device token |
| Muted items | muted scopes |
| Verify this device | step-up, re-authentication |
| Deleted after 30 days | scheduled for hard deletion |
| License | licence |

## Tone

- Say what happens, then what to do. "Your editor tokens were signed out, so reconnect your editor when you next use it."
- No implementation words in the UI: no enums, ids, table or setting names, no "Solid violet…".
- No exclamation marks. No "successfully". Toasts are two to five words.
- A destructive action names its consequence in the button and in the dialog ("Disconnect GitHub", not "Confirm").
- A control that saves at once says nothing more than the result; a control with a Save button says where the changes are.
- Error text says what did not happen and what the person can do. It never shows a server message that is not on the feedback allowlist (`FEEDBACK_COPY`); use `toast.warning` for a specific message that is not a failure.

## Mandatory emails

Emails about the security of the account (password, authenticator, editor tokens, sign-in methods, other devices, account deletion) are always sent. Nothing in Settings can turn them off, and Notifications says so.
