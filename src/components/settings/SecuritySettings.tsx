"use client";

import dynamic from "next/dynamic";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
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

export default function SecurityPage({ embedded = false }: { embedded?: boolean }) {
    const { user } = useAuth();
    const { data: securityData, isLoading, error } = useSecurityData({ hardeningEnabled: true });
    const securityErrorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;
    const passwordAvailable = Boolean(securityData?.password?.hasPassword || hasPasswordCredential(user));
    const verifiedTotpFactors = (securityData?.mfaFactors ?? []).filter(
        (factor) => factor.type === "totp" && factor.status === "verified"
    );
    const primaryVerifiedFactorId = verifiedTotpFactors[0]?.id;
    const stepUpState = {
        hasTotp: Boolean(primaryVerifiedFactorId),
        hasRecoveryCodes: (securityData?.recoveryCodes?.remainingCount ?? 0) > 0,
    };
    const passwordStepUpMethods = buildSecurityStepUpMethods({ ...stepUpState, hasPassword: false })
        .filter((method): method is "totp" | "recovery_code" => method !== "password");
    const sessionStepUpMethods = buildSecurityStepUpMethods({ ...stepUpState, hasPassword: passwordAvailable });

    if (isLoading) {
        return (
            <div className={embedded ? "space-y-8" : "space-y-6"} data-hardening-security="v1">
                {!embedded ? (
                    <SettingsPageHeader
                        title="Security"
                        description="Protect your account with an authenticator app, manage your fallback password, and review recent activity."
                    />
                ) : null}
                <SecuritySectionsSkeleton />
            </div>
        );
    }

    return (
        <div className={embedded ? "space-y-8" : "space-y-6"} data-hardening-security="v1">
            {!embedded ? (
                <SettingsPageHeader
                    title="Security"
                    description="Protect your account with an authenticator app, manage your fallback password, and review recent activity."
                />
            ) : null}

            {securityErrorMessage ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 nb-compact text-destructive">
                    {securityErrorMessage}
                </div>
            ) : null}

            <SettingsSectionCard
                title="Sign-in protection"
                description="Manage the verification methods that protect your account."
            >
                <div data-testid="security-authenticator-section">
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
                    embedded
                    hasPassword={passwordAvailable}
                    lastChangedAt={securityData?.password?.lastChangedAt}
                    availableStepUpMethods={passwordStepUpMethods}
                    primaryTotpFactorId={primaryVerifiedFactorId}
                />
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Sessions and sign-ins"
                description="Review signed-in devices and recent access to your account."
            >
                <div data-testid="security-active-sessions-section">
                    <h4 className="nb-ui-label mb-3 text-foreground">Active sessions</h4>
                    <SessionsList
                        initialSessions={securityData?.sessions}
                        availableStepUpMethods={sessionStepUpMethods}
                        primaryTotpFactorId={primaryVerifiedFactorId}
                    />
                </div>
                <div className="my-6 border-t border-border" />
                <div data-testid="security-login-activity-section">
                    <h4 className="nb-ui-label mb-3 text-foreground">Recent sign-ins</h4>
                    <LoginHistory initialHistory={securityData?.loginHistory} />
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Security activity"
                description="Review recent changes to account protection."
                testId="security-activity-section"
            >
                <SecurityActivitySection activity={securityData?.securityActivity} />
            </SettingsSectionCard>
        </div>
    );
}
