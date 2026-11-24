import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * B1.3b review routing (report 30.9 call 6) as SQL over a copy `c` and its master `m`: true when the viewer reviews
 * this copy. A Rebalance override wins, then reviewers named on the assignment, then the student's section TAs; with
 * none of those, every reviewer (the teacher falls back when a section has no TA).
 */
export function reviewsCopySql(viewerId: string): SQL {
  const sectionTas = sql`SELECT 1 FROM class_section_members st JOIN class_section_members ta ON ta.section_id = st.section_id AND ta.role = 'ta'
    WHERE st.workspace_id = m.workspace_id AND st.user_id = c.assignee_id AND st.role = 'student'`;
  return sql`(CASE
    WHEN c.type_fields ? 'reviewer' THEN c.type_fields->>'reviewer' = ${viewerId}
    WHEN coalesce(jsonb_array_length(m.assignment_settings->'reviewers'), 0) > 0 THEN m.assignment_settings->'reviewers' ? ${viewerId}
    WHEN EXISTS (${sectionTas}) THEN EXISTS (${sectionTas} AND ta.user_id = ${viewerId}::uuid)
    ELSE true END)`;
}
