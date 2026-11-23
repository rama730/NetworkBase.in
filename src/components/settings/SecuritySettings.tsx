"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { useSecurityData } from "@/hooks/useSettingsQueries";
import { useAuth } from "@/hooks/useAuth";
import { hasPasswordCredential } from "@/lib/auth/account-identity";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";

const SecurityLog = dynamic(() => import("@/components/settings/SecurityLog").then((mod) => mod.SecurityLog));
const PasswordManagementSection = dynamic(() => import("@/components/settings/PasswordManagementSection"));
const MfaSetup = dynamic(() => import("@/components/auth/MfaSetup").then((mod) => mod.MfaSetup));
const SessionsList = dynamic(() => import("@/components/settings/SessionsList").then((mod) => mod.SessionsList));
const SignInMethods = dynamic(() => import("@/components/settings/SignInMethods").then((mod) => mod.SignInMethods));
const TrustedBrowsers = dynamic(() => import("@/components/settings/TrustedBrowsers"));

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

    if (isLoading) return <SecuritySectionsSkeleton />;

    // Without the data there is nothing true to show: no sections built from defaults beside an error.
    if (securityErrorMessage && !securityData) {
        return <div className="nbs-body pt-4"><ErrorNotice what="Security settings" onRetry={() => void refetch()} /></div>;
    }

    return (
        <>
            <p className="nbs-callout">
                Don’t recognize something? <a href="#settings-security-sessions">Sign out other devices</a>, then <a href="#settings-security-password">change your password</a>.
            </p>
            <SettingsSectionCard id="settings-security-signin" title="How you sign in" state={hasTotp ? "two-step on" : "two-step off"} stateOk={hasTotp} flush findKeys="sign in login methods password google github email">
                <div className="nbs-list">
                    <PasswordManagementSection
                        hasPassword={passwordAvailable}
                        lastChangedAt={securityData?.password?.lastChangedAt}
                        availableStepUpMethods={passwordStepUpMethods}
                        primaryTotpFactorId={primaryVerifiedFactorId}
                    />
                    <SignInMethods />
                    <MfaSetup initialFactors={securityData?.mfaFactors} recoveryCodes={securityData?.recoveryCodes} />
                </div>
            </SettingsSectionCard>

            <SessionsList
                initialSessions={securityData?.sessions}
                initialNextOffset={securityData?.sessionsNextOffset}
                availableStepUpMethods={sensitiveStepUpMethods}
                primaryTotpFactorId={primaryVerifiedFactorId}
            />

            {primaryVerifiedFactorId ? <TrustedBrowsers /> : null}

            <SecurityLog
                activity={securityData?.securityActivity}
                hasMore={securityData?.securityActivityHasMore}
                history={securityData?.loginHistory}
                sessions={securityData?.sessions}
                availableStepUpMethods={sensitiveStepUpMethods}
                primaryTotpFactorId={primaryVerifiedFactorId}
            />
        </>
    );
}
