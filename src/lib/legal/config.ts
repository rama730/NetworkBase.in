export type LegalIdentity = {
  productName: string;
  operatorName: string;
  postalAddress: string;
  serviceAddress: string;
  country: string;
  supportEmail: string;
  privacyEmail: string;
  welcomeEmail: string;
  notificationsEmail: string;
  grievanceOfficer: string;
  grievanceEmail: string;
  governingLaw: string;
  venue: string;
  identityComplete: boolean;
};

export const OFFICIAL_NETWORKBASE_EMAILS = [
  { address: "welcome@networkbase.in", scope: "Account onboarding, confirmation, and welcome messages" },
  { address: "notifications@networkbase.in", scope: "Task assignments, workspace updates, mentions, and workflow alerts" },
  { address: "support@networkbase.in", scope: "Member assistance, technical support, and helpdesk inquiries" },
  { address: "privacy@networkbase.in", scope: "Privacy disclosures, data protection, and legal correspondence" },
] as const;

function value(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

/**
 * Public legal identity. Production operators should replace the role-based
 * defaults with the registered entity and full service address in Railway.
 */
export function getLegalIdentity(): LegalIdentity {
  const operatorName = value("LEGAL_OPERATOR_NAME", "NetworkBase");
  const postalAddress = value("LEGAL_OPERATOR_ADDRESS", "India");
  const grievanceOfficer = value(
    "LEGAL_GRIEVANCE_OFFICER_NAME",
    "Grievance Officer, NetworkBase",
  );
  const country = value("LEGAL_OPERATOR_COUNTRY", "India");
  const privacyEmail = value("LEGAL_PRIVACY_EMAIL", "privacy@networkbase.in");
  const supportEmail = value("LEGAL_SUPPORT_EMAIL", "support@networkbase.in");
  const welcomeEmail = value("LEGAL_WELCOME_EMAIL", "welcome@networkbase.in");
  const notificationsEmail = value("LEGAL_NOTIFICATIONS_EMAIL", "notifications@networkbase.in");
  const serviceAddress = postalAddress.toLowerCase() === country.toLowerCase()
    ? country
    : `${postalAddress}, ${country}`;

  return {
    productName: "NetworkBase",
    operatorName,
    postalAddress,
    serviceAddress,
    country,
    supportEmail,
    privacyEmail,
    welcomeEmail,
    notificationsEmail,
    grievanceOfficer,
    grievanceEmail: value("LEGAL_GRIEVANCE_EMAIL", privacyEmail),
    governingLaw: value("LEGAL_GOVERNING_LAW", "the laws of India"),
    venue: value("LEGAL_DISPUTE_VENUE", "the competent courts of India"),
    identityComplete: Boolean(
      process.env.LEGAL_OPERATOR_NAME?.trim()
      && process.env.LEGAL_OPERATOR_ADDRESS?.trim()
      && process.env.LEGAL_GRIEVANCE_OFFICER_NAME?.trim(),
    ),
  };
}
