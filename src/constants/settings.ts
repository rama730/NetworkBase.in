import type { SettingsTab } from "@/constants/routes";

/** Section names (nav), the serif line that heads each section, and the plain line under it (settings mix). */
export const SETTINGS_SECTION_META: Record<SettingsTab | "delete-account", { title: string; headline: string; description: string }> = {
    account: { title: "Account", headline: "Your account.", description: "Your email, your standing, and this device. Name, username and picture live on your profile." },
    security: { title: "Security", headline: "Signing in, safely.", description: "How you sign in, where you’re signed in, and what changed." },
    privacy: { title: "Privacy", headline: "Who sees you, who reaches you.", description: "Your profile, messages and requests, what others see of your activity, and who you’ve blocked." },
    notifications: { title: "Notifications", headline: "What reaches you, and when.", description: "What you hear about, when nothing is sent, and where it arrives." },
    appearance: { title: "Appearance", headline: "How NetworkBase looks.", description: "Theme, accent and spacing. Saved to your account, so every device matches." },
    integrations: { title: "Integrations", headline: "Tools connected to your account.", description: "GitHub, and the CLI, agents and editors you’ve signed in, with the tokens they use. Ways to sign in are in Security." },
    "privacy-policies": { title: "Legal and data", headline: "Agreements and your data.", description: "What you accepted, the policies behind it, and your data to take with you." },
    "delete-account": { title: "Delete account", headline: "Delete your account.", description: "Your account and everything in it are removed after 30 days. You can cancel until then." },
};
