import { and, eq, sql, or, notInArray } from "drizzle-orm";
import { replaceSuggestions } from "@/lib/connections/suggestions";
import { inngest } from "../client";
import { db } from "@/lib/db";
import {
    connections,
    connectionSuggestions,
    profiles,
    projects,
    projectOpenRoles
} from "@/lib/db/schema";
import { matchingSkillLabels } from "@/lib/skills/matching";

export const computeSocialGraphSuggestions = inngest.createFunction(
    { id: "social-graph-suggestions", retries: 1 },
    { event: "workspace/connections.sync_suggestions" },
    async ({ event, step }) => {
        const { userId } = event.data;

        // 1. Fetch user's active projects and their open roles for skill matching
        const myOpenRoles = await step.run("fetch-my-open-roles", async () => {
            return await db
                .select({
                    roleTitle: projectOpenRoles.title,
                    requiredSkills: projectOpenRoles.skills,
                })
                .from(projectOpenRoles)
                .innerJoin(projects, eq(projectOpenRoles.projectId, projects.id))
                .where(and(
                    eq(projects.ownerId, userId),
                    eq(projects.status, 'active')
                ));
        });

        const myProfile = await step.run("fetch-my-skills", async () => {
            const [p] = await db
                .select({ skills: profiles.skills })
                .from(profiles)
                .where(eq(profiles.id, userId))
                .limit(1);
            return p;
        });

        // 2. Compute mutuals, score, and upsert in a single step to eliminate large cross-step Inngest wire serialization
        const count = await step.run("compute-and-upsert-suggestions", async () => {
            const myConnections = await db
                .select({
                    id: sql<string>`CASE 
                        WHEN ${connections.requesterId} = ${userId} THEN ${connections.addresseeId} 
                        ELSE ${connections.requesterId} 
                    END`
                })
                .from(connections)
                .where(and(
                    eq(connections.status, 'accepted'),
                    or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId))
                ));

            const myConnIds = myConnections.map(c => c.id);
            if (myConnIds.length === 0) {
                await replaceSuggestions(userId, []);
                return 0;
            }

            const result = await db.execute(sql`
                WITH my_network AS (
                    SELECT unnest(${myConnIds}::uuid[]) as friend_id
                ),
                second_degree AS (
                    SELECT 
                        CASE 
                            WHEN c.requester_id = n.friend_id THEN c.addressee_id 
                            ELSE c.requester_id 
                        END as suggested_id,
                        count(*) as mutual_count
                    FROM connections c
                    JOIN my_network n ON (c.requester_id = n.friend_id OR c.addressee_id = n.friend_id)
                    WHERE c.status = 'accepted'
                    GROUP BY suggested_id
                )
                SELECT 
                    s.suggested_id,
                    p.username,
                    p.full_name,
                    p.skills as candidate_skills,
                    p.open_to_collaborate,
                    s.mutual_count::int as mutual_count
                FROM second_degree s
                JOIN profiles p ON s.suggested_id = p.id
                LEFT JOIN connections existing ON (
                    (existing.requester_id = ${userId} AND existing.addressee_id = s.suggested_id) OR
                    (existing.requester_id = s.suggested_id AND existing.addressee_id = ${userId})
                )
                LEFT JOIN connection_suggestion_dismissals dismissed ON (
                    dismissed.user_id = ${userId} AND dismissed.dismissed_profile_id = s.suggested_id
                )
                WHERE s.suggested_id != ${userId}
                  AND existing.id IS NULL
                  AND dismissed.id IS NULL
                ORDER BY s.mutual_count DESC
                LIMIT 100
            `);

            const suggestions = Array.from(result);
            if (suggestions.length === 0) {
                await replaceSuggestions(userId, []);
                return 0;
            }

            const scoredSuggestions = suggestions.map((s: any) => {
                let score = s.mutual_count * 10;
                let reason = `${s.mutual_count} mutual connections`;
                let roleMatched = false;
                const candidateSkills = (s.candidate_skills || []) as string[];

                // Project-Role Alignment matching
                for (const role of s.open_to_collaborate ? myOpenRoles : []) {
                    const roleSkills = role.requiredSkills || [];
                    const matches = matchingSkillLabels(candidateSkills, roleSkills);
                    if (matches.length > 0) {
                        score += 50;
                        reason = `Matches your open role: ${role.roleTitle}`;
                        roleMatched = true;
                        break;
                    }
                }

                // Generic Skill Overlap
                const overlappingSkills = matchingSkillLabels(candidateSkills, myProfile?.skills || []);
                const overlap = overlappingSkills.length;
                if (overlap > 0) {
                    score += overlap * 5;
                    if (!roleMatched) {
                        reason = `Skills overlap: ${overlappingSkills.slice(0, 2).join(", ")}`;
                    }
                }

                return {
                    userId,
                    suggestedUserId: s.suggested_id,
                    mutualConnectionsCount: s.mutual_count,
                    score,
                    reason,
                    updatedAt: new Date(),
                };
            });

            // Take top 50 by score
            const topSuggestions = scoredSuggestions
                .sort((a, b) => b.score - a.score)
                .slice(0, 50);

            if (topSuggestions.length === 0) {
                await replaceSuggestions(userId, []);
                return 0;
            }

            await replaceSuggestions(userId, topSuggestions);

            return topSuggestions.length;
        });

        return { suggestionsCount: count };
    }
);

/** Re-score viewers who already saw a candidate after that candidate changes matching data. */
export const refreshSocialGraphSuggestionsForCandidate = inngest.createFunction(
    { id: "social-graph-suggestions-for-candidate", retries: 1 },
    { event: "workspace/connections.refresh_suggestions_for_candidate" },
    async ({ event, step }) => {
        const viewerRows = await step.run("find-candidate-suggestion-viewers", () =>
            db
                .selectDistinct({ userId: connectionSuggestions.userId })
                .from(connectionSuggestions)
                .where(eq(connectionSuggestions.suggestedUserId, event.data.candidateUserId)),
        );
        const viewerIds = [...new Set([event.data.candidateUserId, ...viewerRows.map((row) => row.userId)])];

        // ponytail: chunks avoid one oversized event request. ceiling: large. upgrade: a paged fan-out job if one sweep outgrows the chunk budget.
        // fan-outs are queued serially here; upgrade to a dedicated fan-out
        // queue if candidate profiles routinely reach tens of thousands of viewers.
        for (let index = 0; index < viewerIds.length; index += 100) {
            await inngest.send(viewerIds.slice(index, index + 100).map((userId) => ({
                name: "workspace/connections.sync_suggestions" as const,
                data: { userId },
            })));
        }
        return { refreshedViewers: viewerIds.length };
    },
);
