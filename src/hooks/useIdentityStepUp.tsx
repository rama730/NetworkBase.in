"use client";

import { useMemo, useRef, useState } from "react";

import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { useAuth } from "@/hooks/useAuth";
import { useSecurityData } from "@/hooks/useSettingsQueries";
import { hasPasswordCredential } from "@/lib/auth/account-identity";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";

/**
 * Report §42.10 problem 12, decision 134: an action that needs a recent identity check opens the same check account
 * deletion uses, in place, then carries on, instead of ending at "Re-authenticate". Same methods as Security settings:
 * the authenticator when there is one, otherwise a password.
 */
export function useIdentityStepUp(title: string, description: string) {
    const { user } = useAuth();
    const { data } = useSecurityData();
    const factorId = (data?.mfaFactors ?? []).find((f) => f.type === "totp" && f.status === "verified")?.id;
    const hasRecoveryCodes = (data?.recoveryCodes?.remainingCount ?? 0) > 0;
    const hasPassword = Boolean(data?.password?.hasPassword || hasPasswordCredential(user));
    const methods = useMemo(
        () => buildSecurityStepUpMethods({ hasTotp: Boolean(factorId), hasRecoveryCodes, hasPassword: factorId ? false : hasPassword }),
        [factorId, hasRecoveryCodes, hasPassword],
    );
    const waiting = useRef<{ retry: () => Promise<void>; cancel: () => void } | null>(null);
    const [open, setOpen] = useState(false);

    /** Runs the action; if it needs the check, asks for it and runs it again once verified. Null if they cancel. */
    async function withIdentity<T extends { errorCode?: string }>(run: () => Promise<T>): Promise<T | null> {
        const result = await run();
        if (result.errorCode !== "STEP_UP_REQUIRED" || methods.length === 0) return result;
        return new Promise<T | null>((resolve) => {
            waiting.current = { retry: async () => resolve(await run()), cancel: () => resolve(null) };
            setOpen(true);
        });
    }

    const dialog = (
        <SecurityStepUpDialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next && waiting.current) {
                    waiting.current.cancel();
                    waiting.current = null;
                }
            }}
            title={title}
            description={description}
            availableMethods={methods}
            factorId={factorId}
            onVerified={async () => {
                const next = waiting.current;
                waiting.current = null;
                setOpen(false);
                await next?.retry();
            }}
        />
    );
    return { withIdentity, dialog };
}
