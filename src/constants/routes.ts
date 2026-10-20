export const ROUTES = {
    HOME: '/',
    LOGIN: '/login',
    SIGNUP: '/signup',
    WORKSPACE: '/workspace',
    DISCOVER: '/discover',
    NETWORK: '/network',
    MESSAGES: '/messages',
    PROJECTS: '/projects',
    SETTINGS: '/settings',
    MY_PROFILE: '/my-profile',
} as const

export const SETTINGS_TABS = [
    "account",
    "security",
    "privacy",
    "notifications",
    "appearance",
    "integrations",
    "privacy-policies",
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export function settingsTabHref(tab: SettingsTab) {
    return tab === "account" ? ROUTES.SETTINGS : `${ROUTES.SETTINGS}?tab=${tab}`
}

