import { inngest } from '../client'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { buildWorkspaceTaskCounterFilters, getWorkspaceCounterWindow } from '@/lib/workspace/counter-logic'

export const reconcileWorkspaceProfileCounters = inngest.createFunction(
    { id: 'reconcile-workspace-profile-counters', name: 'Reconcile Workspace Profile Counters' },
    { cron: '0 4 * * *' },
    async ({ step }) => {
        const { now, todayEnd } = getWorkspaceCounterWindow()
        const deletedAtColumn = sql.raw('"deleted_at"')
        const statusColumn = sql.raw('"status"')
        const dueDateColumn = sql.raw('"due_date"')
        const taskCounterFilters = buildWorkspaceTaskCounterFilters(
            deletedAtColumn,
            statusColumn,
            dueDateColumn,
            now,
            todayEnd,
            sql.raw('"review_status"'),
        )

        await step.run('rebuild-profile-counters', async () => {
            await db.execute(sql`
                WITH task_counts AS (
                    SELECT
                        ${sql.raw('"assignee_id"')} AS user_id,
                        COUNT(*) FILTER (
                            WHERE ${taskCounterFilters.dueToday}
                        )::int AS due_today_count,
                        COUNT(*) FILTER (
                            WHERE ${taskCounterFilters.overdue}
                        )::int AS overdue_count,
                        COUNT(*) FILTER (
                            WHERE ${taskCounterFilters.inProgress}
                        )::int AS in_progress_count
                    FROM ${sql.raw('"tasks"')}
                    WHERE ${sql.raw('"assignee_id"')} IS NOT NULL
                    GROUP BY ${sql.raw('"assignee_id"')}
                ),
                connection_counts AS (
                    SELECT
                        ${sql.raw('"addressee_id"')} AS user_id,
                        COUNT(*) FILTER (WHERE ${sql.raw('"status"')} = 'pending')::int AS inbox_count
                    FROM ${sql.raw('"connections"')}
                    GROUP BY ${sql.raw('"addressee_id"')}
                ),
                relevant_users AS (
                    SELECT user_id FROM task_counts
                    UNION
                    SELECT user_id FROM connection_counts
                    UNION
                    SELECT ${sql.raw('"id"')} AS user_id FROM ${sql.raw('"profiles"')}
                    WHERE ${sql.raw('"workspace_inbox_count"')} > 0
                       OR ${sql.raw('"workspace_due_today_count"')} > 0
                       OR ${sql.raw('"workspace_overdue_count"')} > 0
                       OR ${sql.raw('"workspace_in_progress_count"')} > 0
                ),
                counts AS (
                    SELECT
                        ru.user_id,
                        COALESCE(cc.inbox_count, 0)::int AS inbox_count,
                        COALESCE(tc.due_today_count, 0)::int AS due_today_count,
                        COALESCE(tc.overdue_count, 0)::int AS overdue_count,
                        COALESCE(tc.in_progress_count, 0)::int AS in_progress_count
                    FROM relevant_users ru
                    LEFT JOIN task_counts tc ON tc.user_id = ru.user_id
                    LEFT JOIN connection_counts cc ON cc.user_id = ru.user_id
                )
                UPDATE ${sql.raw('"profiles"')} profile
                SET ${sql.raw('"workspace_inbox_count"')} = counts.inbox_count,
                    ${sql.raw('"workspace_due_today_count"')} = counts.due_today_count,
                    ${sql.raw('"workspace_overdue_count"')} = counts.overdue_count,
                    ${sql.raw('"workspace_in_progress_count"')} = counts.in_progress_count,
                    ${sql.raw('"updated_at"')} = NOW()
                FROM counts
                WHERE profile.${sql.raw('"id"')} = counts.user_id
                  AND (
                    profile.${sql.raw('"workspace_inbox_count"')} IS DISTINCT FROM counts.inbox_count OR
                    profile.${sql.raw('"workspace_due_today_count"')} IS DISTINCT FROM counts.due_today_count OR
                    profile.${sql.raw('"workspace_overdue_count"')} IS DISTINCT FROM counts.overdue_count OR
                    profile.${sql.raw('"workspace_in_progress_count"')} IS DISTINCT FROM counts.in_progress_count
                  )
            `)
        })

        return {
            reconciledAt: now.toISOString(),
        }
    }
)
