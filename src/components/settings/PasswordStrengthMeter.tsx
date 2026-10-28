"use client";

import { PASSWORD_MIN_LENGTH, type PasswordPolicyResult } from "@/lib/security/password-policy";

interface PasswordStrengthMeterProps {
    password: string;
    result: PasswordPolicyResult;
}

interface StrengthResult {
    score: number; // 0-4
    label: string;
    color: string;
    bgColor: string;
}

function calculateStrength(password: string, result: PasswordPolicyResult): StrengthResult {
    if (!password) {
        return { score: 0, label: "", color: "text-muted-foreground", bgColor: "bg-muted" };
    }

    const satisfiedChecks = Object.values(result.checks).filter(Boolean).length;
    const score = Math.min(
        4,
        result.ok
            ? Math.max(3, satisfiedChecks - 1)
            : Math.max(1, [result.checks.minLength, result.checks.uppercase, result.checks.lowercase, result.checks.number]
                .filter(Boolean)
                .length),
    );

    const strengthLevels: Record<number, Omit<StrengthResult, "score">> = {
        0: { label: "", color: "text-muted-foreground", bgColor: "bg-muted" },
        1: { label: "Weak", color: "text-[var(--status-danger)]", bgColor: "bg-[var(--status-danger)]" },
        2: { label: "Fair", color: "text-[var(--status-warning)]", bgColor: "bg-[var(--status-warning)]" },
        3: { label: "Good", color: "text-[var(--status-warning)]", bgColor: "bg-[var(--status-warning)]" },
        4: { label: "Strong", color: "text-[var(--status-success)]", bgColor: "bg-[var(--status-success)]" },
    };

    return { score, ...(strengthLevels[score] as Omit<StrengthResult, "score">) };
}

export function PasswordStrengthMeter({
    password,
    result: passwordPolicy,
}: PasswordStrengthMeterProps) {
    const strength = calculateStrength(password, passwordPolicy);

    if (!password) return null;

    const guidance = !passwordPolicy.checks.minLength
        ? `Use ${PASSWORD_MIN_LENGTH}+ characters`
        : !passwordPolicy.checks.uppercase
            ? "Add an uppercase letter"
            : !passwordPolicy.checks.lowercase
                ? "Add a lowercase letter"
                : !passwordPolicy.checks.number
                    ? "Add a number"
                    : !passwordPolicy.checks.symbol
                        ? "Add a symbol for extra strength"
                        : null;

    return (
        <div className="space-y-2">
            <div className="flex gap-1" role="progressbar" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength.score} aria-valuetext={strength.label || undefined}>
                {[1, 2, 3, 4].map((level) => (
                    <div
                        key={level}
                        className={`h-1.5 flex-1 rounded-full transition-colors duration-[180ms] ${level <= strength.score
                            ? strength.bgColor
                            : "bg-muted"
                            }`}
                    />
                ))}
            </div>

            <div className="flex items-center justify-between">
                <span role="status" className={`nb-meta font-medium ${strength.color}`}>
                    {strength.label}
                </span>
                {guidance ? (
                    <span className="nb-meta text-muted-foreground">
                        {guidance}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
