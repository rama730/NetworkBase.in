"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SettingsStatusChips } from "@/components/settings/ui/SettingsStatusChips";
import { useSecurityData } from "@/hooks/useSettingsQueries";
import { useAuth } from "@/hooks/useAuth";
import { hasPasswordCredential } from "@/lib/auth/account-identity";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";

const SecurityActivitySection = dynamic(() => import("@/components/settings/SecurityActivitySection"));
const PasswordManagementSection = dynamic(() => import("@/components/settings/PasswordManagementSection"));
const MfaSetup = dynamic(() => import("@/components/auth/MfaSetup").then((mod) => mod.MfaSetup));
const SessionsList = dynamic(() => import("@/components/settings/SessionsList").then((mod) => mod.SessionsList));
const LoginHistory = dynamic(() => import("@/components/auth/LoginHistory"));

function SecuritySectionsSkeleton() {
    return <SettingsSectionsSkeleton count={3} />;
}

export default function SecurityPage() {
    const { user } = useAuth();
    const { data: securityData, isLoading, error, refetch } = useSecurityData();
    const securityErrorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;
    const passwordAvailable = Boolean(securityData?.password?.hasPassword || hasPasswordCredential(user));
    const verifiedTotpFactors = (securityData?.mfaFactors ?? []).filter(
        (factor) => factor.type === "totp" && factor.status === "verified"
    );
    const primaryVerifiedFactorId = verifiedTotpFactors[0]?.id;
    const hasTotp = Boolean(primaryVerifiedFactorId);
    const hasRecoveryCodes = (securityData?.recoveryCodes?.remainingCount ?? 0) > 0;
    // Stable arrays: the step-up dialog resets its state whenever these change identity.
    const passwordStepUpMethods = useMemo(
        () => buildSecurityStepUpMethods({ hasTotp, hasRecoveryCodes, hasPassword: false })
            .filter((method): method is "totp" | "recovery_code" => method !== "password"),
        [hasTotp, hasRecoveryCodes],
    );
    const sessionStepUpMethods = useMemo(
        () => buildSecurityStepUpMethods({ hasTotp, hasRecoveryCodes, hasPassword: passwordAvailable }),
        [hasTotp, hasRecoveryCodes, passwordAvailable],
    );
    // Signing other devices out and clearing the activity log must be verified with the authenticator when there is
    // one; a password is offered only when there is no authenticator.
    const sensitiveStepUpMethods = hasTotp ? passwordStepUpMethods : sessionStepUpMethods;

    if (isLoading) {
        return (
            <div className="space-y-8">
                <SecuritySectionsSkeleton />
            </div>
        );
    }

    return (
        <div className="space-y-8">

            {/* Without the data there is nothing true to show: no sections built from defaults beside an error. */}
            {securityErrorMessage && !securityData ? (
                <ErrorNotice what="Security settings" onRetry={() => void refetch()} />
            ) : null}
            {securityErrorMessage && !securityData ? null : (
            <>
            <SettingsStatusChips
                label="Security summary"
                items={[
                    { label: "Password", value: passwordAvailable ? "Set" : "Not set", tone: passwordAvailable ? "ok" : "attention", href: "/settings#settings-security-password" },
                    { label: "Two-step verification", value: hasTotp ? "On" : "Off", tone: hasTotp ? "ok" : "attention", href: "/settings#settings-security-authenticator" },
                    { label: "Signed-in devices", value: String(securityData?.sessions?.length ?? 0), href: "/settings#settings-security-sessions" },
                ]}
            />
            <p className="nb-compact text-muted-foreground">
                Don’t recognize something? <a href="#settings-security-sessions" className="font-medium text-foreground underline underline-offset-4">Sign out other devices</a>, then <a href="#settings-security-password" className="font-medium text-foreground underline underline-offset-4">change your password</a>.
            </p>
            <SettingsSectionCard
                title="Two-step verification"
                description="Manage the verification methods that protect your account."
            >
                <div id="settings-security-authenticator" data-testid="security-authenticator-section" className="scroll-mt-6">
                    <div className="mb-4">
                        <h4 className="nb-ui-label text-foreground">Authenticator app</h4>
                        <p className="nb-compact mt-1 text-muted-foreground">Use a 6-digit code as an extra verification step.</p>
                    </div>
                    <MfaSetup
                        initialFactors={securityData?.mfaFactors}
                        recoveryCodes={securityData?.recoveryCodes}
                    />
                </div>
                <div className="my-6 border-t border-border" />
                <PasswordManagementSection
                    hasPassword={passwordAvailable}
                    lastChangedAt={securityData?.password?.lastChangedAt}
                    availableStepUpMethods={passwordStepUpMethods}
                    primaryTotpFactorId={primaryVerifiedFactorId}
                />
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Signed-in devices"
                description="Review signed-in devices and recent access to your account."
            >
                <div id="settings-security-sessions" data-testid="security-active-sessions-section" className="scroll-mt-6">
                    <h4 className="nb-ui-label mb-3 text-foreground">Signed-in devices</h4>
                    <SessionsList
                        initialSessions={securityData?.sessions}
                        initialNextOffset={securityData?.sessionsNextOffset}
                        availableStepUpMethods={sensitiveStepUpMethods}
                        primaryTotpFactorId={primaryVerifiedFactorId}
                    />
                </div>
                <div className="my-6 border-t border-border" />
                <div id="settings-security-sign-ins" data-testid="security-login-activity-section" className="scroll-mt-6">
                    <h4 className="nb-ui-label mb-3 text-foreground">Recent sign-ins</h4>
                    <LoginHistory initialHistory={securityData?.loginHistory} availableStepUpMethods={sensitiveStepUpMethods} primaryTotpFactorId={primaryVerifiedFactorId} />
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Sign-in activity"
                description="Review recent changes to account protection."
                testId="security-activity-section"
                id="settings-security-activity"
            >
                <SecurityActivitySection activity={securityData?.securityActivity} hasMore={securityData?.securityActivityHasMore} availableStepUpMethods={sensitiveStepUpMethods} primaryTotpFactorId={primaryVerifiedFactorId} />
            </SettingsSectionCard>
            </>
            )}
        </div>
    );
}
