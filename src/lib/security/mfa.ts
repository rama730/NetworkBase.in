import type { AuthMFAListFactorsResponse, UserResponse } from "@supabase/supabase-js";

type AuthMfaFactor = {
  id?: string | number | null;
  factor_type: string;
  friendly_name?: string;
  created_at?: string;
  status?: string;
};

export type SecurityMfaFactor = {
  id: string;
  type: "totp" | "phone";
  friendly_name?: string;
  created_at?: string;
  status: "verified" | "unverified";
};

/**
 * supabase-js reads factors off `getUser`, but our server client answers `getUser` from the token, which carries
 * none, so every account looked like it had no authenticator. This asks the Auth server instead. A failed read
 * stays an error: treating it as "none" would drop the authenticator check from every protected action.
 */
export function factorListFromAuthServer(getUser: () => Promise<UserResponse>) {
  return async (): Promise<AuthMFAListFactorsResponse> => {
    const { data, error } = await getUser();
    if (error) return { data: null, error };
    const all = data.user?.factors ?? [];
    const verified = all.filter((factor) => factor.status === "verified");
    return {
      data: {
        all,
        totp: verified.filter((factor) => factor.factor_type === "totp"),
        phone: verified.filter((factor) => factor.factor_type === "phone"),
        webauthn: verified.filter((factor) => factor.factor_type === "webauthn"),
      } as NonNullable<AuthMFAListFactorsResponse["data"]>,
      error: null,
    };
  };
}

function requireSecurityMfaFactorId(factor: AuthMfaFactor) {
  const normalizedId = typeof factor.id === "string"
    ? factor.id.trim()
    : factor.id === undefined || factor.id === null
      ? ""
      : String(factor.id).trim();

  if (!normalizedId) {
    throw new Error(`MFA factor is missing an id for factor_type "${factor.factor_type}"`);
  }

  return normalizedId;
}

export async function listSecurityMfaFactors(
  supabase: {
    auth?: {
      mfa?: {
        listFactors?: () => Promise<{
          data?: { all?: readonly AuthMfaFactor[] } | null;
          error?: unknown;
        }>;
      };
    };
  },
): Promise<SecurityMfaFactor[]> {
  const mfaApi = supabase.auth?.mfa;
  if (!mfaApi?.listFactors) {
    return [];
  }

  const result = await mfaApi.listFactors();
  if (result.error) {
    throw result.error instanceof Error ? result.error : new Error("Couldn’t list MFA factors");
  }
  const allFactors = Array.isArray(result?.data?.all) ? result.data.all : [];

  return allFactors
    .filter((factor) => factor?.factor_type === "totp" || factor?.factor_type === "phone")
    .map((factor) => ({
      id: requireSecurityMfaFactorId(factor),
      type: factor.factor_type === "phone" ? "phone" : "totp",
      friendly_name: factor.friendly_name || undefined,
      created_at: typeof factor.created_at === "string" ? factor.created_at : undefined,
      status: factor.status === "verified" ? "verified" : "unverified",
    }));
}

export function getVerifiedTotpFactors(factors: SecurityMfaFactor[]): SecurityMfaFactor[] {
  return factors.filter((factor) => factor.type === "totp" && factor.status === "verified");
}
