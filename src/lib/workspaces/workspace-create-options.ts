export const WORKSPACE_TYPE_OPTIONS = [
    { id: "side_project", label: "Side project", description: "Personal workspace or hobby" },
    { id: "startup", label: "Startup", description: "Building a business" },
    { id: "open_source", label: "Open source", description: "Community contribution" },
    { id: "learning", label: "Learning workspace", description: "Skill development" },
    { id: "hackathon", label: "Hackathon", description: "Competition workspace" },
    { id: "freelance", label: "Freelance/Client", description: "Client work" },
    { id: "creative", label: "Creative/Art", description: "Art or design workspace" },
    { id: "nonprofit", label: "Non-Profit", description: "Social impact" },
    { id: "game", label: "Game dev", description: "Video game workspace" },
    { id: "web_app", label: "Web app", description: "Web application" },
    { id: "ecommerce", label: "E-Commerce", description: "Online store" },
    { id: "tool", label: "Developer tool", description: "Dev tools and utilities" },
    { id: "content", label: "Content/Blog", description: "Content platform" },
    { id: "podcast", label: "Podcast/Audio", description: "Audio content" },
    { id: "video", label: "Video/Media", description: "Video content" },
] as const;

export const OTHER_WORKSPACE_TYPE_ID = "other";

export const POPULAR_WORKSPACE_TAGS = [
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

export function isKnownWorkspaceType(value: string) {
    return value === OTHER_WORKSPACE_TYPE_ID || WORKSPACE_TYPE_OPTIONS.some((type) => type.id === value);
}
