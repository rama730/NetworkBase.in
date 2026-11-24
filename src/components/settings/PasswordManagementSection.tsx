"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { toast, feedbackError } from "@/lib/feedback";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SavedTick } from "@/components/ui/SavedTick";
import { Tag } from "@/components/settings/mix/parts";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import TurnstileWidget, { hasTurnstileSiteKey, SECURITY_CHECK_PROMPT } from "@/components/auth/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCalendarDate } from "@/lib/ui/date-formatting";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { useChangePassword } from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { getPasswordPolicyResult, PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
import type { SecurityData } from "@/types/settingsTypes";

type SecurityStepUpMethod = "totp" | "recovery_code";

type PasswordManagementSectionProps = {
  hasPassword: boolean;
  lastChangedAt?: string;
  availableStepUpMethods: SecurityStepUpMethod[];
  primaryTotpFactorId?: string;
};

export default function PasswordManagementSection({
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
  const [submitted, setSubmitted] = useState(false);
  const [signOutOtherDevices, setSignOutOtherDevices] = useState(true);
  // null: not checked yet or couldn't be checked (the server checks again on submit).
  const [breached, setBreached] = useState<boolean | null>(null);
  // Checking the current password needs a Turnstile token (Supabase's CAPTCHA protection); one per attempt.
  const requiresCaptcha = hasPassword && hasTurnstileSiteKey();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const [savedCount, setSavedCount] = useState(0);
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirty = isEditing && Boolean(currentPassword || newPassword || confirmPassword);
  // Leaving a half-filled form asks first (settings mix v2, improvement 16).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  // "Not you?" in the log opens this form.
  useEffect(() => {
    const open = (event: Event) => { if ((event as CustomEvent).detail === "password") { setIsEditing(true); window.setTimeout(() => document.getElementById(hasPassword ? "current-password" : "new-password")?.focus(), 50); } };
    window.addEventListener("nbs:open", open);
    return () => window.removeEventListener("nbs:open", open);
  }, [hasPassword]);
  const isChangingPassword = changePasswordMutation.isPending;
  const title = hasPassword ? "Change password" : "Set a password";
  const passwordPolicy = getPasswordPolicyResult(newPassword);

  // Once the password meets the policy, ask whether it has appeared in a data breach, after a short pause in typing,
  // so the answer arrives while the person is still on the form and not as a rejection on submit.
  const policyOk = passwordPolicy.ok;
  useEffect(() => {
    setBreached(null);
    if (!policyOk) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/v1/auth/password-safety", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
        signal: controller.signal,
      })
        .then((response) => response.json().catch(() => null))
        .then((payload) => {
          if (payload?.errorCode === "LEAKED_PASSWORD") setBreached(true);
          else if (payload?.success) setBreached(false);
        })
        .catch(() => undefined);
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [newPassword, policyOk]);

  const resetForm = () => {
    setSubmitted(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setSignOutOtherDevices(true);
  };

  const submitPasswordChange = async () => {
    if (requiresCaptcha && !captchaToken) {
      toast.info(SECURITY_CHECK_PROMPT);
      return;
    }
    const token = captchaToken;
    if (requiresCaptcha) {
      setCaptchaToken(null);
      setCaptchaKey((key) => key + 1);
    }
    const result = await changePasswordMutation.mutateAsync({ currentPassword, newPassword, signOutOtherDevices, captchaToken: token });
    if (!result.success) {
      const errorCode = "errorCode" in result ? result.errorCode : undefined;
      if (errorCode === "STEP_UP_REQUIRED") {
        setStepUpOpen(true);
        return;
      }
      toast.error(feedbackError(result.message || "Couldn’t update password", "Couldn’t update password"));
      return;
    }

    setSavedCount((n) => n + 1);
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
    setSubmitted(true);

    if (newPassword !== confirmPassword) {
      toast.warning("Passwords don’t match");
      document.getElementById("confirm-password")?.focus();
      return;
    }

    // The submit button stays disabled until the policy passes, so there is no "requirements" branch here.
    await submitPasswordChange();
  };

  const content = (
    <>
      <SecurityListRow
        id="settings-security-password"
        tile={<span className="tile" aria-hidden="true"><KeyRound strokeWidth={1.75} /></span>}
        title="Password"
        badges={hasPassword ? null : <Tag>Not set</Tag>}
        details={hasPassword
          ? `Set${lastChangedAt ? ` · changed ${formatCalendarDate(lastChangedAt)}` : ""} · at least ${PASSWORD_MIN_LENGTH} characters, checked against breaches`
          : `Add one with at least ${PASSWORD_MIN_LENGTH} characters to sign in with your email and a password.`}
        action={<>
          {savedCount ? <SavedTick key={savedCount} /> : null}
          {!isEditing ? <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>{hasPassword ? "Change" : "Set a password"}</Button> : null}
        </>}
      >
      <div data-testid="security-password-section">
        {isEditing ? (
          <form onSubmit={(event) => void handlePasswordSubmit(event)} className="space-y-4">
            {hasPassword ? (
              <div className="space-y-2">
                <label htmlFor="current-password" className="nb-ui-label text-foreground">Current password</label>
                <div className="relative">
                  <Input
                    id="current-password"
                    autoComplete="current-password"
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
                    aria-label="Show current password"
                    aria-pressed={showCurrentPassword}
                    className="absolute right-0 top-0 flex h-full items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {requiresCaptcha ? (
                  <TurnstileWidget
                    key={captchaKey}
                    action="change-password"
                    onVerify={setCaptchaToken}
                    onExpire={() => setCaptchaToken(null)}
                  />
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="new-password" className="nb-ui-label text-foreground">New password</label>
                <div className="relative">
                  <Input
                    id="new-password"
                    aria-invalid={submitted && !passwordPolicy.ok}
                    aria-describedby={submitted && !passwordPolicy.ok ? "new-password-error" : undefined}
                    autoComplete="new-password"
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
                    aria-label="Show new password"
                    aria-pressed={showNewPassword}
                    className="absolute right-0 top-0 flex h-full items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <PasswordStrengthMeter squares password={newPassword} result={passwordPolicy} />
                {submitted && !passwordPolicy.ok && <p id="new-password-error" className="nb-compact text-destructive">{passwordPolicy.error}</p>}
                {breached ? <p role="alert" className="nb-compact text-destructive">This password has appeared in a data breach. Choose a different one.</p> : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-password" className="nb-ui-label text-foreground">Confirm new password</label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    aria-invalid={Boolean((submitted || confirmPassword) && newPassword !== confirmPassword)}
                    aria-describedby={(submitted || confirmPassword) && newPassword !== confirmPassword ? "confirm-password-error" : undefined}
                    autoComplete="new-password"
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
                    aria-label="Show confirm password"
                    aria-pressed={showConfirmPassword}
                    className="absolute right-0 top-0 flex h-full items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {(submitted || confirmPassword) && newPassword !== confirmPassword ? (
                  <p id="confirm-password-error" className="nb-compact text-destructive">Passwords don’t match.</p>
                ) : null}
              </div>
            </div>

            <label className="flex min-h-11 items-center gap-3 nb-compact text-foreground">
              <Checkbox
                checked={signOutOtherDevices}
                onCheckedChange={(checked) => setSignOutOtherDevices(checked === true)}
                disabled={isChangingPassword}
              />
              Sign out my other devices
            </label>
            <p className="nb-meta text-muted-foreground">
              If you lose access later, use “Forgot password” on the sign-in page. Editor tokens always end when the password changes.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isChangingPassword || !passwordPolicy.ok || breached === true}>
                {isChangingPassword ? (
                  <>
                    <PixelBeat />
                    Saving...
                  </>
                ) : (
                  title
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isChangingPassword}
                onClick={() => {
                  if (dirty) { setDiscardOpen(true); return; }
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
      </SecurityListRow>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard the new password?"
        description="What you typed is cleared. Your password stays as it is."
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => { resetForm(); setIsEditing(false); }}
      />

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

  return content;
}
