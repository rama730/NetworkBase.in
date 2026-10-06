export const DISCOVER_RANKING_WEIGHTS = {
    candidateLimit: 280,
    trending: {
        views: 0.45,
        follows: 1.3,
        recency: 0.03,
    },
    quality: {
        shortDescription: 0.3,
        coverImage: 0.15,
        tags: 0.2,
        skills: 0.25,
        lifecycle: 0.1,
    },
    recommendation: {
        titleMatch: 4.5,
        descriptionMatch: 2.8,
        skillsMatch: 5.5,
        tagsMatch: 3.2,
        categoryMatch: 2,
        trendBlend: 0.35,
        coldStartBlend: 0.85,
    },
    diversity: {
        ownerPenalty: 0.55,
        categoryPenalty: 0.3,
    },
} as const;

export const DISCOVER_RANKING_SCHEMA_VERSION = 3;
