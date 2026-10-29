export const PROJECT_TYPE_OPTIONS = [
    { id: "side_project", label: "Side project", description: "Personal project or hobby" },
    { id: "startup", label: "Startup", description: "Building a business" },
    { id: "open_source", label: "Open source", description: "Community contribution" },
    { id: "learning", label: "Learning project", description: "Skill development" },
    { id: "hackathon", label: "Hackathon", description: "Competition project" },
    { id: "freelance", label: "Freelance/Client", description: "Client work" },
    { id: "creative", label: "Creative/Art", description: "Art or design project" },
    { id: "nonprofit", label: "Non-Profit", description: "Social impact" },
    { id: "game", label: "Game dev", description: "Video game project" },
    { id: "web_app", label: "Web app", description: "Web application" },
    { id: "ecommerce", label: "E-Commerce", description: "Online store" },
    { id: "tool", label: "Developer tool", description: "Dev tools and utilities" },
    { id: "content", label: "Content/Blog", description: "Content platform" },
    { id: "podcast", label: "Podcast/Audio", description: "Audio content" },
    { id: "video", label: "Video/Media", description: "Video content" },
] as const;

export const OTHER_PROJECT_TYPE_ID = "other";

export const POPULAR_PROJECT_TAGS = [
    "AI/ML",
    "Web3",
    "SaaS",
    "Mobile",
    "API",
    "Fintech",
    "EdTech",
    "HealthTech",
    "E-commerce",
    "DevTools",
];

export function isKnownProjectType(value: string) {
    return value === OTHER_PROJECT_TYPE_ID || PROJECT_TYPE_OPTIONS.some((type) => type.id === value);
}
