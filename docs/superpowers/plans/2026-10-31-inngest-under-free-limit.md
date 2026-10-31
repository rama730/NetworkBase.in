# Inngest Under the Free Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut scheduled Inngest usage from about 12,000 executions a day to about 1,000, under the 50,000-a-month Hobby limit (about 1,650 a day), without making any user-visible message or email later than it is today, except where listed below.

**Architecture:** Slow the timers. The two things people notice, scheduled chat messages and important push notifications, stop polling and instead wake on an Inngest event at the moment they are due, keeping an hourly sweep as the safety net. A test holds the schedule to a budget so this cannot creep back.

**Tech Stack:** Inngest 3 (`inngest.send` with `id` and future `ts`), Next.js 16 server actions, Railway worker.

**Spec:** The user's choice in this session: reduce runs rather than upgrade. Usage from the Inngest dashboard on 2026-10-31: 348,808 executions this month, 1,440 runs a day each for `chat-due` and `storage-asset-backup`.

## Global Constraints

- No code until the user says "implement". No push, Railway change or Inngest change until told, separately.
- Base the work on what is live. Local `main` is 31 behind and 33 ahead of `origin/main`, so Task 0 reconciles it first.
- Business logic in the jobs stays as it is. This changes when jobs run, not what they do.
- A wake is only a hint: it must never fail or slow the user's action (1-second limit, same as `wakeEmailWorker` in `src/lib/email/outbox.ts`). The hourly sweep is the guarantee.
- After deploy the worker needs an Inngest re-sync.

## Target Schedule

"Each" is the run plus its steps, which is how Inngest counts.

| Job | Now | New | Each | Per day |
|---|---|---|---|---|
| `chat-due` | every minute | `15 * * * *` + wake | 5 | 120 |
| `storage-asset-backup` | every minute | `25 * * * *`, batch 100 → 500 | 2 | 48 |
| `storage-asset-deletion` | every 5 min | `0 */2 * * *`, batch 100 → 500 | 6 | 72 |
| `notification-push-delivery` | every 5 min | `30 * * * *` + wake | 3 | 72 |
| `email-outbox-delivery` | every 5 min + wake | `*/30 * * * *` + wake | 3 | 144 |
| `lock-cleanup` | every 5 min | `50 * * * *` | 1 | 24 |
| `trust-deadlines` | every 15 min | `*/30 * * * *` | 2 | 96 |
| `upload-intent-cleanup` | every 15 min | `55 * * * *` | 2 | 48 |
| `flush-project-likes` (does nothing: nothing writes its data) | every 15 min | `*/30 * * * *` | 2 | 96 |
| `chat-integrity-audit` | hourly | `40 4 * * *` | 3 | 3 |
| `trust-daily-summary` | hourly | `35 2 * * *` (08:05 IST; its 8 am IST check still passes) | 3 | 3 |
| `project-files-permanent-delete` | hourly | `0 */6 * * *` | 3 | 12 |
| `workspace-files-reconciliation`, `sprint-schedule`, `git-sync-recovery`, `project-import-stale-reconcile`, `trust-restrictions`, `org-due-soon`, `org-admin-digest` | hourly | unchanged | 1–2 | 264 |
| Daily jobs and the 6-hourly watchdog | unchanged | unchanged | | about 44 |
| **Total** | **about 12,000** | | | **about 1,050** |

A run that fills its batch (email, chat, push) asks for the next run straight away, so slower timers never mean less work done.

That leaves about 650 a day (about 19,000 a month) for real activity such as notifications and emails.

Must stay hourly: `workspace-files-reconciliation` (its one-week full-pass promise is calculated from 24 runs a day), `trust-restrictions` (its notice window is measured in hours) and `org-due-soon` / `org-admin-digest` (they act where it is 9 am or 8 am locally).

## What People Will Notice

| What | Today | After |
|---|---|---|
| Scheduled chat messages and reminders | within a minute | on time, usually sooner; an hour at worst if a wake is lost |
| Important push notifications | up to 5 min | about 1–2 min; up to an hour at worst if a wake is lost, or after quiet hours or a snooze ends |
| First attempt of an email | immediately | unchanged |
| Retry of a failed email | up to 5 min | up to 30 min |
| Trust deadline notices | up to 15 min | up to 30 min |
| File and asset cleanup, integrity audit | minutes to an hour | up to 2 hours, 6 hours, and daily |

## Review Focus

1. A message scheduled more than 7 days ahead: Inngest limits future events on the free plan, so nothing may depend on a far-future event. The hourly sweep arms anything due in the next hour; actions only send a wake when the due time is within the hour.
2. Rescheduling or cancelling: a wake that fires for a moved or cancelled message must do nothing, and the new time must still send on time.
3. Inngest unavailable or over its limit: scheduling a message or creating a notification still succeeds, quickly.
4. A burst of important notifications or many messages due in one minute: one run per minute, not one per item (event `id` per minute).
5. A push wake firing before the notification's transaction commits: the wake is set a minute ahead, and the sweep catches anything missed.

---

### Task 0: Bring local `main` up to live

- [ ] **Step 1:** Stop if another session is mid-work in this checkout. Run `git pull --rebase --autostash origin main`. Commits already on GitHub drop out by themselves.
- [ ] **Step 2:** Resolve any conflict in the three commits only here (`86a261cb2`, `b99c1862f`, `e3b18aaae`) in favour of what is live. If one is already covered, skip it and record which in the final report.
- [ ] **Step 3:** Run `npm ci` and `npm run test:unit`. Expected: same as `origin/main`, 0 failures.

### Task 1: One wake helper

**Files:** Create `src/inngest/wake.ts`. Test `tests/unit/inngest-wake.test.ts`.

**Produces:** `wakeAt(name: WakeEvent, at: Date, inngestClient = inngest): Promise<void>`, where `WakeEvent` is `"chat/due.wake" | "notification/push.wake"`. Modify `src/inngest/types.ts` to declare both events with empty data.

- [ ] **Step 1: Write the failing tests.** With a fake client: sends `{ name, data: {}, ts: at.getTime(), id: "<name>:<at rounded up to the minute>" }`, and two times in the same minute produce the same `id`. A client that throws, and one that never answers, both resolve within about 1 second and log `logger.warn`, never throw.
- [ ] **Step 2:** Run `npx tsx --test tests/unit/inngest-wake.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement, rounding `ts` up to the minute so nearby items share one run.
- [ ] **Step 4:** Run it. Expected: PASS. Commit `feat(inngest): a wake that can never block the caller`.

### Task 2: Scheduled messages and reminders wake on time

**Files:** Modify `src/inngest/functions/chat-maintenance.ts:51-61`, `src/app/actions/chat/later.ts` (`saveMessage` line 28, `scheduleMessage` line 123, `rescheduleScheduled` line 212), `src/lib/messaging/due.ts`. Test `tests/unit/chat-due-wake.test.ts`.

**Produces:** `dueTimesWithinNextHour(limit = 200): Promise<Date[]>` in `due.ts`, returning distinct minutes from unsent `chat_scheduled_messages.send_at` and unfired `chat_saved.remind_at`. `wakeChatDueIfSoon(at: Date, now = new Date())` in `due.ts`, which only wakes when `at` is within 65 minutes.

- [ ] **Step 1: Write the failing tests.** `wakeChatDueIfSoon` wakes at +10 min and not at +8 days. A database test: `dueTimesWithinNextHour` returns a message due in 30 min and a reminder due in 45 min, and skips sent, failed, and more-than-an-hour-away rows. Source check: triggers are `[{ event: "chat/due.wake" }, { cron: "15 * * * *" }]`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** In `chatDue`, after the two existing steps, add step `arm-next-hour`: for each time from `dueTimesWithinNextHour`, `wakeAt("chat/due.wake", time)`. Call `wakeChatDueIfSoon` after each of the three successful writes, not inside a transaction. Update the "every minute" and "within a minute" comments.
- [ ] **Step 4:** Run them plus the existing chat tests and `npm run check:chat:actions`. Expected: PASS. Commit `feat(chat): scheduled messages wake on time instead of polling`.

### Task 3: Important push wakes on creation

**Files:** Modify `src/inngest/functions/notification-push-delivery.ts`, `src/lib/notifications/service.ts:260,391`. Test `tests/unit/notification-push-wake.test.ts`.

- [ ] **Step 1: Write the failing tests.** Creating an `important` notification wakes `notification/push.wake` about a minute ahead; a `normal` one does not; a throwing wake leaves the notification created. Source check on triggers: `[{ event: "notification/push.wake" }, { cron: "30 * * * *" }]`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Read both insert sites first and wake only for rows actually inserted, without awaiting inside a transaction.
- [ ] **Step 4:** Run them and the existing notification tests. Expected: PASS. Commit `feat(notifications): important push wakes when created`.

### Task 4: Slow the timers, and hold them to a budget

**Files:** Modify the cron line of each remaining job in Target Schedule, `BACKUP_BATCH_SIZE` in `src/lib/storage/asset-backup.ts:16`, the cadence comment at `src/lib/trust/jobs.ts:47`. Test `tests/unit/inngest-budget.test.ts`.

**Produces:** a test that reads every `cron:` in `src/inngest/functions/`, computes runs per day and fails over budget.

- [ ] **Step 1: Write the failing test.** No job runs more often than every 30 minutes. Total scheduled runs per day ≤ 480. `trust-deadlines` still runs at least hourly, because the trust health summary alerts when it hasn't run in an hour (`src/lib/trust/jobs.ts:105`).
- [ ] **Step 2:** Run `npx tsx --test tests/unit/inngest-budget.test.ts`. Expected: FAIL, listing today's schedule.
- [ ] **Step 3:** Change the schedules and the batch size exactly as in the table, with a `ponytail:` comment on the budget naming the 50,000 ceiling and the upgrade path (a paid plan).
- [ ] **Step 4:** A test that `runTrustDailySummary(new Date("2026-11-02T02:35:00Z"))` passes its 8 am IST check.
- [ ] **Step 5:** Run `npm run test:unit`, `npm run typecheck`. Expected: PASS. Commit `chore(inngest): scheduled jobs fit the free limit`.

### Task 5: Prove it, review it

- [ ] **Step 1:** On a scratch copy with the Inngest dev server: schedule a message 2 minutes ahead and confirm it sends on time from one run. Reschedule one, cancel one, and confirm neither double-sends. Create an important notification and confirm one push run starts within about 2 minutes.
- [ ] **Step 2:** Run `ponytail-review`, then `review`, then fix findings.

### Task 6: Rollout (needs the user's separate go-ahead)

- [ ] **Step 1:** Push. Railway builds both services.
- [ ] **Step 2:** User re-syncs the app in Inngest (Apps → nb-s3 → Resync; the URL is `https://networkbase-worker-production.up.railway.app/api/inngest`).
- [ ] **Step 3:** Schedule one real message and confirm it arrives on time.
- [ ] **Step 4:** After 24 hours, read the Inngest dashboard. Expected: about 1,000–1,500 executions a day, and no new Sentry errors from jobs.
