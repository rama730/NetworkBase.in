"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Shield,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast, feedbackError } from "@/lib/feedback";
import { getTotpVerificationErrorMessage, normalizeTotpQrCodeSource } from "@/lib/auth/mfa-ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { MfaFactor, SecurityData } from "@/types/settingsTypes";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { formatCalendarDate, formatDateTime } from "@/lib/ui/date-formatting";
import { saveBlob } from "@/lib/download";
import { copyText } from "@/lib/clipboard";

interface MfaSetupProps {
  initialFactors?: MfaFactor[];
  recoveryCodes?: SecurityData["recoveryCodes"];
}

type PendingTotpFactor = {
  id: string;
  qrCodeDataUrl: string;
  secret: string;
};

type RevealedRecoveryCodes = {
  codes: string[];
  generatedAt?: string;
};

type ProtectedAction =
  | { type: "remove"; factorId: string }
  | { type: "regenerate-recovery-codes" }
  | null;

function formatRecoveryCodesForExport(codes: string[]): string {
  return [
    "NetworkBase recovery codes",
    "",
    "Each code can be used once.",
    "",
    ...codes,
    "",
    "Store these codes in a safe place.",
  ].join("\n");
}

export function MfaSetup({ initialFactors, recoveryCodes }: MfaSetupProps) {
  const queryClient = useQueryClient();
  const [supabase] = useState(() => createSupabaseBrowserClient());

  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [protectedActionPending, setProtectedActionPending] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [pendingFactor, setPendingFactor] = useState<PendingTotpFactor | null>(null);
  const [unenrollId, setUnenrollId] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [protectedAction, setProtectedAction] = useState<ProtectedAction>(null);
  const [revealedRecoveryCodes, setRevealedRecoveryCodes] = useState<RevealedRecoveryCodes | null>(null);

  const refreshSecurity = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
  };

  const factors = initialFactors ?? [];
  const verifiedFactors = factors.filter((factor) => factor.type === "totp" && factor.status === "verified");
  const pendingFactors = factors.filter((factor) => factor.type === "totp" && factor.status === "unverified");
  const primaryVerifiedFactor = verifiedFactors[0] ?? null;
  const hasVerifiedFactor = verifiedFactors.length > 0;

  const protectedMethods: Array<"totp" | "recovery_code"> = [
    ...(primaryVerifiedFactor ? ["totp" as const] : []),
    ...((recoveryCodes?.remainingCount ?? 0) > 0 ? ["recovery_code" as const] : []),
  ];

  const cleanupPendingFactor = async (factorId: string) => {
    try {
      await supabase.auth.mfa.unenroll({ factorId });
    } catch {
    }
  };

  const resetSetupDialog = () => {
    setVerificationCode("");
    setPendingFactor(null);
    setEnrolling(false);
    setVerifying(false);
  };

  const handleSetupOpenChange = async (open: boolean) => {
    // Esc or a click outside mid-request would reset the dialog under a check that is still running.
    if (!open && (verifying || enrolling)) return;
    if (!open && pendingFactor && !verifying) {
      await cleanupPendingFactor(pendingFactor.id);
      await refreshSecurity();
    }

    if (!open) {
      resetSetupDialog();
    }

    setSetupOpen(open);
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      await Promise.all(pendingFactors.map((factor) => cleanupPendingFactor(factor.id)));

      const result = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
        issuer: "NetworkBase",
      });

      if (result.error || !result.data) {
        throw new Error(result.error?.message || "Couldn’t start authenticator setup");
      }

      setPendingFactor({
        id: result.data.id,
        qrCodeDataUrl: normalizeTotpQrCodeSource(result.data.totp.qr_code) ?? "",
        secret: result.data.totp.secret,
      });
      setVerificationCode("");
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t start authenticator setup", "Couldn’t start authenticator setup"));
    } finally {
      setEnrolling(false);
    }
  };

  const handleGenerateRecoveryCodes = async (mode: "initial" | "regenerate") => {
    const response = await fetch("/api/v1/auth/mfa/recovery-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });
    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok || json?.success === false) {
      throw new Error(json?.message || "Couldn’t generate recovery codes");
    }

    setRevealedRecoveryCodes({
      codes: Array.isArray(json?.data?.codes) ? json.data.codes : [],
      generatedAt: typeof json?.data?.generatedAt === "string" ? json.data.generatedAt : undefined,
    });
    await refreshSecurity();
  };

  const handleVerify = async () => {
    if (!pendingFactor) return;

    const code = verificationCode.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      setVerificationError("Enter the current 6-digit code from your authenticator.");
      toast.warning("Enter the 6-digit code");
      document.getElementById("mfa-verification-code")?.focus();
      return;
    }

    setVerificationError(null);
    setVerifying(true);
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId: pendingFactor.id,
        code,
      });

      if (result.error) {
        throw result.error;
      }

      const outcomeId = toast.success("Authenticator enabled");
      resetSetupDialog();
      setSetupOpen(false);
      await refreshSecurity();

      try {
        await handleGenerateRecoveryCodes("initial");
      } catch {
        const generateCodes = async () => {
          toast.loading("Creating recovery codes…", { id: outcomeId });
          try {
            await handleGenerateRecoveryCodes("initial");
            toast.success("Recovery codes generated", { id: outcomeId, description: "Save your codes privately." });
          } catch {
            toast.warning("Authenticator enabled", { id: outcomeId, description: "Recovery codes missing.", action: { label: "Get codes", onClick: generateCodes } });
          }
        };
        toast.warning("Authenticator enabled", { id: outcomeId, description: "Recovery codes missing.", action: { label: "Get codes", onClick: generateCodes } });
      }
    } catch (error) {
      const message = getTotpVerificationErrorMessage(error as Error);
      setVerificationError(message);
      toast.error(feedbackError(message, "Code couldn’t be verified"));
    } finally {
      setVerifying(false);
    }
  };

  const executeProtectedAction = async (action: ProtectedAction) => {
    if (!action) return;

    setProtectedActionPending(true);
    try {
      if (action.type === "remove") {
        const res = await fetch(`/api/v1/auth/mfa/factors/${action.factorId}`, {
          method: "DELETE",
        });
        const contentType = res.headers.get("content-type") || "";
        const json = contentType.includes("application/json") ? await res.json() : null;
        if (!res.ok || json?.success === false) {
          throw new Error(json?.message || `Couldn’t remove MFA factor (${res.status})`);
        }

        toast.success("Authenticator removed");
      }

      if (action.type === "regenerate-recovery-codes") {
        await handleGenerateRecoveryCodes("regenerate");
        toast.success("Recovery codes regenerated");
      }

      await refreshSecurity();
      setProtectedAction(null);
      setUnenrollId(null);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t complete this security action", "Couldn’t complete this security action"));
    } finally {
      setProtectedActionPending(false);
    }
  };

  const handleCopySecret = async () => {
    if (!pendingFactor) return;

    try {
      await copyText(pendingFactor.secret);
      toast.success("Setup key copied");
    } catch {
      toast.error("Couldn’t copy the secret on this device");
    }
  };

  const handleCopyRecoveryCodes = async () => {
    if (!revealedRecoveryCodes) return;
    try {
      await copyText(formatRecoveryCodesForExport(revealedRecoveryCodes.codes));
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Couldn’t copy the recovery codes on this device");
    }
  };

  const handleDownloadRecoveryCodes = () => {
    if (!revealedRecoveryCodes) return;
    const blob = new Blob([formatRecoveryCodesForExport(revealedRecoveryCodes.codes)], { type: "text/plain;charset=utf-8" });
    saveBlob(blob, "networkbase-recovery-codes.txt");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {hasVerifiedFactor ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 nb-meta font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Enabled
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 nb-meta font-medium text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            Not set up
          </div>
        )}
        <p className="nb-compact text-muted-foreground">
          {hasVerifiedFactor
            ? "Sign-in asks for a code from your authenticator app."
            : "Add a 6-digit code from an authenticator app for extra protection."}
        </p>
      </div>

      {primaryVerifiedFactor ? (
        <div className="space-y-2">
            <div
              key={primaryVerifiedFactor.id}
              className="flex min-h-16 items-center justify-between rounded-md border border-border bg-background p-3"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                </div>
                <div>
                  <div className="nb-ui-label text-foreground">
                    Authenticator app
                  </div>
                  <div className="nb-meta text-muted-foreground">
                    Added {primaryVerifiedFactor.created_at ? formatCalendarDate(primaryVerifiedFactor.created_at) : "recently"}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="pointer-coarse:h-11 pointer-coarse:w-11"
                aria-label="Remove authenticator app"
                title="Remove authenticator app"
                onClick={() => setUnenrollId(primaryVerifiedFactor.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
        </div>
      ) : (
        <p className="nb-compact text-muted-foreground">
          No authenticator app is set up yet.
        </p>
      )}

      {pendingFactors.length > 0 ? (
        <div className="rounded-md border border-border bg-muted px-4 py-3 nb-compact text-foreground">
          A previous authenticator setup was not completed. Starting again will replace the unfinished setup.
        </div>
      ) : null}

      {hasVerifiedFactor ? (
        <div className="rounded-md border border-border bg-muted/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="nb-ui-label text-foreground">
                Recovery codes
              </div>
              <div className="nb-compact text-muted-foreground">
                {recoveryCodes?.configured
                  ? `${recoveryCodes.remainingCount} code${recoveryCodes.remainingCount === 1 ? "" : "s"} remaining`
                  : "Generate one-time recovery codes in case you lose access to your authenticator app."}
              </div>
              {recoveryCodes?.generatedAt ? (
                <div className="nb-meta text-muted-foreground">
                  Last generated {formatDateTime(recoveryCodes.generatedAt)}
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={protectedActionPending}
              onClick={() => {
                if (recoveryCodes?.configured) {
                  setProtectedAction({ type: "regenerate-recovery-codes" });
                  setStepUpOpen(true);
                  return;
                }
                void handleGenerateRecoveryCodes("initial").catch((error) => {
                  toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t generate recovery codes", "Couldn’t generate recovery codes"));
                });
              }}
            >
              {recoveryCodes?.configured ? "Regenerate recovery codes" : "Generate recovery codes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/50 p-4 nb-compact text-muted-foreground">
          Recovery codes become available after you finish authenticator setup.
        </div>
      )}

      {!hasVerifiedFactor ? <div className="flex flex-wrap gap-3">
        <Button onClick={() => setSetupOpen(true)}>
          Set up authenticator app
        </Button>
      </div> : null}

      <Dialog open={setupOpen} onOpenChange={(open) => { void handleSetupOpenChange(open); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pendingFactor ? "Verify your authenticator app" : "Set up an authenticator app"}
            </DialogTitle>
            <DialogDescription>
              {pendingFactor
                ? "Scan the QR code or enter the secret manually, then confirm with the 6-digit code from your app."
                : "Add an authenticator app as your main extra layer of protection."}
            </DialogDescription>
          </DialogHeader>

          {!pendingFactor ? (
            <p className="nb-compact text-muted-foreground">When setup is confirmed, you will receive 10 one-time recovery codes to store safely.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="rounded-md border border-border bg-background p-3">
                  {pendingFactor.qrCodeDataUrl ? (
                    <Image
                      src={pendingFactor.qrCodeDataUrl}
                      alt="Authenticator QR code"
                      width={160}
                      height={160}
                      unoptimized
                      className="mx-auto h-40 w-40"
                    />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center rounded-md border border-dashed border-border text-center nb-meta text-muted-foreground">
                      QR code unavailable on this device. Use the manual setup key instead.
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-muted/50 p-3">
                    <div className="nb-meta font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Manual setup key
                    </div>
                    <div className="mt-2 break-all font-mono text-[13px] text-foreground">
                      {pendingFactor.secret}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={handleCopySecret}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy secret
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="mfa-verification-code" className="text-sm font-medium leading-none">6-digit code</label>
                    <Input
                      id="mfa-verification-code"
                      aria-invalid={Boolean(verificationError)}
                      aria-describedby={verificationError ? "mfa-verification-error" : undefined}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      pattern="[0-9]*"
                      maxLength={6}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleVerify(); } }}
                      value={verificationCode}
                      onChange={(event) =>
                        { setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setVerificationError(null); }
                      }
                      placeholder="Enter the current code"
                      disabled={verifying}
                    />
                    {verificationError && <p id="mfa-verification-error" className="nb-compact text-destructive">{verificationError}</p>}
                    <p className="nb-meta text-muted-foreground">
                      Use the current 6-digit code from your authenticator app. Codes refresh every 30 seconds.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={enrolling || verifying}
              onClick={() => {
                void handleSetupOpenChange(false);
              }}
            >
              Cancel
            </Button>
            {!pendingFactor ? (
              <Button type="button" onClick={handleEnroll} disabled={enrolling}>
                {enrolling ? (
                  <>
                    <PixelBeat />
                    Preparing...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            ) : (
              <Button type="button" onClick={handleVerify} disabled={verifying}>
                {verifying ? (
                  <>
                    <PixelBeat />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm setup
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedRecoveryCodes} onOpenChange={(open) => { if (!open) setRevealedRecoveryCodes(null); }}>
        {/* Shown once: only the button closes this, so a stray Esc or click outside cannot throw the codes away. */}
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Save your recovery codes</DialogTitle>
            <DialogDescription>
              Each code can be used once if you lose access to your authenticator app. Store them somewhere safe now: they are not shown again after you close this.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border border-border bg-muted/50 p-4 font-mono text-[13px] sm:grid-cols-2">
              {(revealedRecoveryCodes?.codes ?? []).map((code) => (
                <div key={code} className="rounded-md border border-border bg-background px-3 py-2 text-foreground">
                  {code}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyRecoveryCodes()}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleDownloadRecoveryCodes}>
                <Download className="h-4 w-4" />
                Download .txt
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" onClick={() => setRevealedRecoveryCodes(null)}>
              I saved these codes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!unenrollId}
        onOpenChange={(open) => { if (!open) setUnenrollId(null); }}
        title="Remove authenticator app?"
        description="Your recovery codes stop working too. You will need to set up an authenticator app again to turn this protection back on."
        confirmLabel="Continue"
        variant="destructive"
        onConfirm={async () => {
          if (!unenrollId) return;
          setProtectedAction({ type: "remove", factorId: unenrollId });
          setStepUpOpen(true);
        }}
      />

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={(open) => {
          setStepUpOpen(open);
          if (!open && !protectedActionPending) {
            setProtectedAction(null);
          }
        }}
        title="Verify this device"
        description={protectedAction?.type === "regenerate-recovery-codes" ? "Complete one more check. New recovery codes replace your current ones, so the old codes stop working." : "Complete one more check before changing authenticator settings."}
        availableMethods={protectedMethods}
        factorId={primaryVerifiedFactor?.id}
        onVerified={async () => {
          await executeProtectedAction(protectedAction);
        }}
      />
    </div>
  );
}
