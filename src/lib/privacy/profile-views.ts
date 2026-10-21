import { normalizeProfile } from "@/lib/utils/normalize-profile";
import type { PrivacyRelationshipState } from "@/lib/privacy/relationship-state";

type ViewerScopedProfileSource = Record<string, unknown> & { id: string };
export type ProfileView = ReturnType<typeof normalizeProfile>;

export function buildViewerScopedProfileView(params: {
  profile: ViewerScopedProfileSource | null | undefined;
  relationship: PrivacyRelationshipState | null;
  isOwner?: boolean;
}): ProfileView | null {
  const profile = normalizeProfile(params.profile);
  if (!profile) return null;

  const isOwner = params.isOwner ?? false;
  const blocked = Boolean(params.relationship?.blockedByTarget || params.relationship?.blockedByViewer);
  const exposeIdentity = isOwner || Boolean(params.relationship && !blocked);
  const exposeFullProfile = isOwner || Boolean(params.relationship?.canViewProfile);
  const safe = {
    id: profile.id,
    username: exposeIdentity ? profile.username : null,
    fullName: exposeIdentity ? profile.fullName : null,
    avatarUrl: exposeIdentity ? profile.avatarUrl : null,
    headline: exposeIdentity ? profile.headline : null,
    location: exposeIdentity ? profile.location : null,
    visibility: profile.visibility ?? "public",
    profileStrength: isOwner ? profile.profileStrength : 0,
    completionMissing: isOwner ? profile.completionMissing : [],
    connectionsCount: exposeFullProfile ? profile.connectionsCount : 0,
    projectsCount: exposeFullProfile ? profile.projectsCount : 0,
    followersCount: exposeFullProfile ? profile.followersCount : 0,
    bio: profile.bio,
    website: profile.website,
    bannerUrl: profile.bannerUrl,
    socialLinks: profile.socialLinks,
    // Link health is recovery state for the owner, not public profile data.
    socialLinkMetadata: isOwner ? profile.socialLinkMetadata ?? {} : {},
    openTo: profile.openTo,
    openToCollaborate: profile.openToCollaborate,
    openToCustomRoles: profile.openToCustomRoles,
    preferredCategories: profile.preferredCategories,
    experienceLevel: profile.experienceLevel,
    hoursPerWeek: profile.hoursPerWeek,
    // Sensitive and shown nowhere on a public profile: the owner can read and edit them, nobody else.
    genderIdentity: isOwner ? profile.genderIdentity ?? null : null,
    pronouns: isOwner ? profile.pronouns ?? null : null,
    skills: profile.skills,
    interests: profile.interests,
    // Legacy profile JSON is an owner-only edit document. Public project
    // contributions are served from the normalized, visibility-scoped API.
    experience: isOwner ? profile.experience : [],
    education: profile.education,
    // AUTH-011: Presence and activity timestamps are strictly resolved via getPresence action for non-owners
    lastActiveAt: isOwner ? profile.lastActiveAt ?? null : null,
    messagePrivacy: profile.messagePrivacy ?? null,
    connectionPrivacy: profile.connectionPrivacy ?? null,
    createdAt: profile.createdAt ?? null,
    updatedAt: profile.updatedAt ?? null,
  };

  return exposeFullProfile ? safe : {
    ...safe,
    profileStrength: 0,
    completionMissing: [],
    connectionsCount: 0,
    projectsCount: 0,
    followersCount: 0,
    bio: null,
    website: null,
    bannerUrl: null,
    socialLinks: {},
    openTo: [],
    openToCollaborate: false,
    openToCustomRoles: [],
    preferredCategories: [],
    experienceLevel: null,
    hoursPerWeek: null,
    skills: [],
    interests: [],
    experience: [],
    education: [],
    lastActiveAt: null,
    messagePrivacy: null,
    connectionPrivacy: null,
    createdAt: null,
    updatedAt: null,
  };
}
