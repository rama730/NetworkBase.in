import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileSecurityStates, profiles } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { parseStoredRecoveryCodes, type StoredRecoveryCode } from "@/lib/security/recovery-codes";
import { isSafeHttpUrl } from "@/lib/security/urls";
import { PROFILE_FIELD_LIMITS } from "@/lib/validations/profile-fields";

export type ProtectedRecoveryCodes = {
  hasRecoveryCodes: boolean;
  recoveryCodesGeneratedAt: Date | null;
  securityRecoveryCodes: StoredRecoveryCode[];
};

export async function getProtectedRecoveryCodes(userId: string, options: { authorized: boolean }): Promise<ProtectedRecoveryCodes | null> {
  if (!options.authorized) throw new Error("Recovery code access is not authorized");
  try {
    const state = await db.query.profileSecurityStates.findFirst({
      columns: { securityRecoveryCodes: true, recoveryCodesGeneratedAt: true },
      where: eq(profileSecurityStates.userId, userId),
    });
    const securityRecoveryCodes = parseStoredRecoveryCodes(state?.securityRecoveryCodes);
    return {
      securityRecoveryCodes,
      recoveryCodesGeneratedAt: state?.recoveryCodesGeneratedAt ?? null,
      hasRecoveryCodes: securityRecoveryCodes.length > 0 || Boolean(state?.recoveryCodesGeneratedAt),
    };
  } catch (error) {
    logger.error("profile-service.getProtectedRecoveryCodes.failed", { userId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function readAuthMetadataString(metadata: User["user_metadata"], key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A name that fits the profile limits (2 to 80 characters), or null: a provider can send either extreme. */
function fitsNameLimits(value: string | null | undefined) {
  const trimmed = value?.trim().slice(0, PROFILE_FIELD_LIMITS.fullNameMax).trim();
  return trimmed && trimmed.length >= PROFILE_FIELD_LIMITS.fullNameMin ? trimmed : null;
}

export function buildProfileShellMetadata(userEmail: string, metadata: User["user_metadata"]) {
  // The provider photo is user-editable metadata, so it passes the same safe-URL gate as an uploaded one.
  const avatarUrl = readAuthMetadataString(metadata, "avatar_url");
  return {
    fullName:
      fitsNameLimits(readAuthMetadataString(metadata, "full_name"))
      || fitsNameLimits(readAuthMetadataString(metadata, "name"))
      || fitsNameLimits(userEmail.split("@")[0]?.replace(/[._-]+/g, " "))
      || null,
    avatarUrl: avatarUrl && isSafeHttpUrl(avatarUrl) ? avatarUrl : null,
  };
}

export async function ensureProfileShell(params: {
  userId: string;
  userEmail: string | null | undefined;
  metadata: User["user_metadata"];
}): Promise<{ success: true } | { success: false; error: "missing_email" | "db_error" }> {
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.id, params.userId), columns: { id: true } });
  if (existing) return { success: true };
  const userEmail = params.userEmail?.trim();
  if (!userEmail) return { success: false, error: "missing_email" };
  const shell = buildProfileShellMetadata(userEmail, params.metadata);
  try {
    const inserted = await db.insert(profiles).values({ id: params.userId, email: userEmail, fullName: shell.fullName, avatarUrl: shell.avatarUrl, updatedAt: new Date() }).onConflictDoNothing().returning({ id: profiles.id });
    if (inserted.length > 0) return { success: true };
    const recovered = await db.query.profiles.findFirst({ where: eq(profiles.id, params.userId), columns: { id: true } });
    return recovered ? { success: true } : { success: false, error: "db_error" };
  } catch (error) {
    logger.error("profile.ensure_shell_failed", { module: "profile", userId: params.userId, error });
    return { success: false, error: "db_error" };
  }
}
