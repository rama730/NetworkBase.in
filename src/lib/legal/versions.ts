export const LEGAL_VERSIONS = {
  privacy: "2026-10-29",
  terms: "2026-10-29",
  eula: "2026-10-29",
  acceptableUse: "2026-10-29",
  cookies: "2026-10-29",
  subprocessors: "2026-10-29",
  copyright: "2026-10-29",
  grievances: "2026-10-29",
  security: "2026-10-29",
  support: "2026-10-29",
  dpa: "2026-10-29",
  openSource: "2026-10-29",
} as const;

export const LEGAL_EFFECTIVE_DATE = "October 29, 2026";

export const CURRENT_LEGAL_ACCEPTANCE = {
  termsVersion: LEGAL_VERSIONS.terms,
  eulaVersion: LEGAL_VERSIONS.eula,
  privacyNoticeVersion: LEGAL_VERSIONS.privacy,
} as const;
