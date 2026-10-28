/** How long a verified step-up stays valid. Lives here so client copy and the server cookie agree. */
export const SECURITY_STEP_UP_MAX_AGE_SECONDS = 5 * 60;

export type SecurityStepUpMethod = "totp" | "recovery_code" | "password";

export function buildSecurityStepUpMethods(input: {
  hasTotp: boolean;
  hasRecoveryCodes: boolean;
  hasPassword: boolean;
}): SecurityStepUpMethod[] {
  return [
    ...(input.hasTotp ? ["totp" as const] : []),
    ...(input.hasRecoveryCodes ? ["recovery_code" as const] : []),
    ...(input.hasPassword ? ["password" as const] : []),
  ];
}
