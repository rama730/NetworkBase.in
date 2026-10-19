"use client";

import { toast } from "sonner";
import type { FormEvent } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { useChangePassword } from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { getPasswordPolicyResult, PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
import type { SecurityData } from "@/types/settingsTypes";

type SecurityStepUpMethod = "totp" | "recovery_code";

type PasswordManagementSectionProps = {
  embedded?: boolean;
  hasPassword: boolean;
  lastChangedAt?: string;
  availableStepUpMethods: SecurityStepUpMethod[];
  primaryTotpFactorId?: string;
};

export default function PasswordManagementSection({
  embedded = false,
  hasPassword,
  lastChangedAt,
  availableStepUpMethods,
  primaryTotpFactorId,
}: PasswordManagementSectionProps) {
  const queryClient = useQueryClient();
  const changePasswordMutation = useChangePassword();
  const [isEditing, setIsEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  const isChangingPassword = changePasswordMutation.isPending;
  const title = hasPassword ? "Change password" : "Set a password";
  const description = hasPassword
    ? "Manage the password used with this account."
    : "Add a password so email sign-in is available on this account.";
  const statusLabel = hasPassword ? "Password available" : "No password set";
  const helperCopy = hasPassword
    ? `Prefer a strong password with at least ${PASSWORD_MIN_LENGTH} characters.`
    : `Add a strong password with at least ${PASSWORD_MIN_LENGTH} characters if you want email sign-in available on this account.`;
  const passwordPolicy = getPasswordPolicyResult(newPassword);
  const formattedLastChanged = lastChangedAt ? new Date(lastChangedAt).toLocaleString() : null;

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const submitPasswordChange = async () => {
    const result = await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
    if (!result.success) {
      const errorCode = "errorCode" in result ? result.errorCode : undefined;
      if (errorCode === "STEP_UP_REQUIRED") {
        setStepUpOpen(true);
        return;
      }
      toast.error(result.message || "Failed to update password");
      return;
    }

    toast.success(hasPassword ? "Password updated successfully" : "Password added successfully");
    resetForm();
    setIsEditing(false);
    queryClient.setQueryData<SecurityData>(queryKeys.settings.security(), (current) => current ? {
      ...current,
      password: { ...current.password, hasPassword: true, lastChangedAt: new Date().toISOString() },
    } : current);
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (!passwordPolicy.ok) {
      toast.error(passwordPolicy.error || "Password does not meet security requirements");
      return;
    }

    await submitPasswordChange();
  };

  const content = (
    <>
      <div className="space-y-4" data-testid="security-password-section">
        <div className="flex min-h-16 flex-col justify-center gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h4 className="nb-ui-label text-foreground">Password</h4>
            <p className="nb-compact mt-1 text-muted-foreground">{statusLabel}. {helperCopy}</p>
            {formattedLastChanged ? <p className="nb-meta mt-1 text-muted-foreground">Last changed {formattedLastChanged}</p> : null}
          </div>

        {!isEditing ? (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            {title}
          </Button>
        ) : null}
        </div>

        {isEditing ? (
          <form onSubmit={(event) => void handlePasswordSubmit(event)} className="space-y-4">
            {hasPassword ? (
              <div className="space-y-2">
                <label htmlFor="current-password" className="nb-ui-label text-foreground">Current password</label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                    disabled={isChangingPassword}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword((prev) => !prev)}
                    aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
                    className="absolute right-0 top-0 flex h-full items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="new-password" className="nb-ui-label text-foreground">New password</label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                    disabled={isChangingPassword}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                    className="absolute right-0 top-0 flex h-full items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <PasswordStrengthMeter password={newPassword} result={passwordPolicy} />
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-password" className="nb-ui-label text-foreground">Confirm new password</label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    disabled={isChangingPassword}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    className="absolute right-0 top-0 flex h-full items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword ? (
                  <p className="nb-compact text-destructive">Passwords do not match.</p>
                ) : null}
              </div>
            </div>

            <p className="nb-meta text-muted-foreground">
              Recovery is handled from the sign-in flow if you ever lose access.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isChangingPassword || !passwordPolicy.ok}>
                {isChangingPassword ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  title
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isChangingPassword}
                onClick={() => {
                  resetForm();
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Complete one more check before changing your password."
        availableMethods={availableStepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={async () => {
          await submitPasswordChange();
        }}
      />
    </>
  );

  if (embedded) return content;

  return (
    <SettingsSectionCard title="Password" description={description}>
      {content}
    </SettingsSectionCard>
  );
}
