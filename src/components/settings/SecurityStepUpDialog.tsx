"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import TurnstileWidget, { hasTurnstileSiteKey, SECURITY_CHECK_PROMPT } from "@/components/auth/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast, feedbackError } from "@/lib/feedback";
import { SECURITY_STEP_UP_MAX_AGE_SECONDS, type SecurityStepUpMethod } from "@/lib/security/step-up-methods";

type SecurityStepUpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  availableMethods: SecurityStepUpMethod[];
  factorId?: string;
  onVerified: () => void | Promise<void>;
};

const METHOD_LABELS: Record<SecurityStepUpMethod, string> = {
  totp: "Authenticator app",
  recovery_code: "Recovery code",
  password: "Password",
};

export default function SecurityStepUpDialog({
  open,
  onOpenChange,
  title,
  description,
  availableMethods,
  factorId,
  onVerified,
}: SecurityStepUpDialogProps) {
  const defaultMethod = availableMethods[0] ?? null;
  const [method, setMethod] = useState<SecurityStepUpMethod | null>(defaultMethod);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Supabase's CAPTCHA protection checks a password only with a Turnstile token, as on the sign-in page. Tokens are
  // single-use, so each attempt remounts the widget for a fresh one.
  const requiresCaptcha = hasTurnstileSiteKey();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const renewCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((key) => key + 1);
  };

  useEffect(() => {
    if (!open) {
      setCode("");
      setPassword("");
      setCaptchaToken(null);
      setSubmitting(false);
      setMethod(defaultMethod);
      return;
    }
    setMethod((current) => (current && availableMethods.includes(current) ? current : defaultMethod));
  }, [availableMethods, defaultMethod, open]);

  // Esc and a click outside also come through here: once the check is running, closing would not stop the
  // action that follows it, so the dialog stays until it finishes.
  const handleOpenChange = (next: boolean) => {
    if (!next && submitting) return;
    onOpenChange(next);
  };

  // Nothing to verify with (no password, authenticator or recovery codes): say so instead of showing nothing.
  if (!method) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a way to verify first</DialogTitle>
            <DialogDescription>
              This change needs a second check, and there is nothing to check with yet. Add an authenticator app in Security, then try again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitDisabled) return;
    const usesCaptcha = method === "password" && requiresCaptcha;
    if (usesCaptcha && !captchaToken) {
      toast.info(SECURITY_CHECK_PROMPT);
      return;
    }
    setSubmitting(true);
    try {
      const payload = method === "password"
        ? { method, password, ...(captchaToken ? { captchaToken } : {}) }
        : { method, code: code.trim(), ...(method === "totp" ? { factorId } : {}) };
      if (usesCaptcha) renewCaptcha();

      const response = await fetch("/api/v1/auth/security-step-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const contentType = response.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await response.json() : null;
      if (!response.ok || json?.success === false) {
        throw new Error(json?.message || "Couldn’t verify this device");
      }

      // The action that follows reports its own result; a second "verified" toast would stack on it.
      await onVerified();
      setSubmitting(false);
      onOpenChange(false);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t verify this device", "Couldn’t verify this device"));
    } finally {
      setSubmitting(false);
    }
  };

  const isTotp = method === "totp";
  const isRecoveryCode = method === "recovery_code";
  const submitDisabled = submitting
    || (isTotp && (!factorId || !/^[0-9]{6}$/.test(code.trim())))
    || (isRecoveryCode && code.trim().length < 6)
    || (method === "password" && password.length === 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {availableMethods.length > 1 ? (
            <div role="radiogroup" aria-label="Verification method" className="flex flex-wrap gap-2">
              {availableMethods.map((entry) => (
                <Button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={entry === method}
                  size="sm"
                  variant={entry === method ? "secondary" : "outline"}
                  disabled={submitting}
                  onClick={() => {
                    setMethod(entry);
                    setCode("");
                    setPassword("");
                  }}
                >
                  {METHOD_LABELS[entry]}
                </Button>
              ))}
            </div>
          ) : null}

          {method !== "password" ? (
            <div className="space-y-2">
              <label htmlFor="security-step-up-code" className="nb-ui-label text-foreground">{isTotp ? "Current 6-digit code" : "Recovery code"}</label>
              <Input
                id="security-step-up-code"
                autoFocus
                autoComplete="one-time-code"
                inputMode={isTotp ? "numeric" : undefined}
                pattern={isTotp ? "[0-9]*" : undefined}
                maxLength={isTotp ? 6 : undefined}
                value={code}
                onChange={(event) => setCode(isTotp ? event.target.value.replace(/\D/g, "").slice(0, 6) : event.target.value.toUpperCase())}
                placeholder={isTotp ? "123456" : "ABCD-EFGH"}
                disabled={submitting}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="security-step-up-password" className="nb-ui-label text-foreground">Current password</label>
              <Input
                id="security-step-up-password"
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                disabled={submitting}
              />
              {requiresCaptcha ? (
                <TurnstileWidget
                  key={captchaKey}
                  action="step-up"
                  onVerify={setCaptchaToken}
                  onExpire={() => setCaptchaToken(null)}
                />
              ) : null}
            </div>
          )}

          <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 nb-compact text-muted-foreground">
            This verification stays active for up to {Math.round(SECURITY_STEP_UP_MAX_AGE_SECONDS / 60)} minutes on this device.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {submitting ? (
                <>
                  <PixelBeat />
                  Verifying...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Verify device
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
