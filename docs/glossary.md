# NetworkBase glossary

Generated from `src/lib/copy/terms.ts` by `scripts/generate-glossary.ts`. The full vocabulary, pronunciations and reasons are in `docs/audits/terminology-roles-workspace-audit-2026-10-28.md` §8–10.

## Access levels

| Stored value | Shown as |
|---|---|
| `owner` | Owner |
| `admin` | Admin |
| `member` | Member |
| `viewer` | Viewer |

## Workspace status

| Stored value | Shown as |
|---|---|
| `draft` | Draft |
| `active` | Active |
| `completed` | Completed |
| `archived` | Archived |

## Task status

| Stored value | Shown as |
|---|---|
| `todo` | To do |
| `in_progress` | In progress |
| `in_review` | In review |
| `blocked` | Blocked |
| `done` | Completed |

## Sprint status

| Stored value | Shown as |
|---|---|
| `planning` | Upcoming |
| `active` | Active |
| `completed` | Completed |
| `archived` | Archived |
| `cancelled` | Canceled |

## Notification delivery

| Stored value | Shown as |
|---|---|
| `mandatory` | Required |
| `important` | Important |
| `standard` | Normal |
| `digest` | Summary |
| `realtime` | Instant |

## Conversation types

| Stored value | Shown as |
|---|---|
| `channel` | Channel |
| `dm` | Direct message |
| `group` | Group message |
| `self` | Notes to self |
| `application` | Application conversation |

## Legal pages

| Stored value | Shown as |
|---|---|
| `terms` | Terms of Service |
| `privacy` | Privacy Policy |
| `cookies` | Cookie Notice |
| `acceptableUse` | Acceptable Use Policy |
| `eula` | EULA |
| `subprocessors` | Subprocessors |
| `dpa` | Data Processing Addendum |
| `copyright` | Copyright complaints |
| `security` | Security reporting |
| `grievances` | Grievance redressal |

## Notification categories

- **Mentions and replies**: When someone mentions you or replies to you
- **Invitations and requests**: Invitations, connection requests and join requests
- **Applications and roles**: New applications and decisions
- **Members and access**: People joining, leaving and changing access level
- **Tasks**: Tasks assigned to you, reviews and due dates
- **Sprints and stages**: Sprint and stage changes
- **Files and documents**: Files and documents shared with you
- **Updates and announcements**: Posts from workspaces and organizations you follow
- **Assignments**: Assignments, submissions and returns
- **Security**: Security changes

## Report reasons

- **Spam**
- **Harassment**
- **Hate speech**
- **Impersonation**
- **Inappropriate content**
- **Other**

## Compensation

- **Unpaid (volunteer)**
- **Paid**
- **Equity**
- **Revenue share**

## Words not to use

| Pattern | Use instead |
|---|---|
| `\bco-?lead(?:er)?s?\b` | Admin |
| `\bproject (?:lead\|leads\|leader\|leaders\|leadership\|owner)\b` | Owner (or "owner and admins") |
| `^(?:Lead\|Leader\|Leaders\|Leadership)$` | Owner, Team lead or a role title |
| `\bleaders?-only\b\|\bleadership\b` | owner and admins |
| `\bcollaborators?\b` | Member (in a workspace) or Contributor (on a contribution) |
| `\bdanger zone\b` | Workspace management |
| `\bchild projects?\b` | Workspace in {organization} |
| `\bunit lead\b` | Team lead |
| `\bproject feed\b` | Updates |
