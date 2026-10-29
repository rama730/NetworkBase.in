import type { ApplicationStatusResult } from "@/app/actions/applications/types";

export type ApplicationStatusLoad = "loading" | "ready" | "error";

export type ApplyCardState = {
    /** The line above the role list: where the viewer's application stands. */
    banner: { tone: "success" | "warning" | "danger" | "muted"; text: string; detail?: string } | null;
    /** Why Apply is off for every role, or null when the viewer may apply. */
    blockedReason: string | null;
    /** What the row of the role they applied for says (other rows just say Apply). */
    appliedRowLabel: "Pending" | "Declined" | "Filled" | "Withdrawn" | null;
    applyLabel: "Apply" | "Apply again";
    canEdit: boolean;
    canWithdraw: boolean;
    canRetry: boolean;
};

const NOTHING: Pick<ApplyCardState, "appliedRowLabel" | "canEdit" | "canWithdraw" | "canRetry"> = {
    appliedRowLabel: null,
    canEdit: false,
    canWithdraw: false,
    canRetry: false,
};

/** One place that decides what the Open roles card tells an applicant, so it can be tested without a browser. */
export function describeApplyCard(
    status: ApplicationStatusResult,
    options: { load: ApplicationStatusLoad; projectClosed: boolean },
): ApplyCardState {
    if (options.load === "loading") {
        return { ...NOTHING, banner: null, blockedReason: "Checking your application…", applyLabel: "Apply" };
    }
    if (options.load === "error" || status.loadFailed) {
        return {
            ...NOTHING,
            canRetry: true,
            banner: { tone: "warning", text: "Couldn’t check your application." },
            blockedReason: "Try again to see whether you can apply.",
            applyLabel: "Apply",
        };
    }

    const closed = options.projectClosed ? "This workspace is no longer taking applications." : null;
    const reasonText = status.decisionReasonText?.trim() || undefined;

    switch (status.status) {
        case "pending":
            return {
                banner: { tone: "warning", text: "Application pending review" },
                blockedReason: "You already have an application pending review.",
                appliedRowLabel: "Pending",
                applyLabel: "Apply",
                canEdit: Boolean(status.editableUntil),
                canWithdraw: Boolean(status.applicationId),
                canRetry: false,
            };
        case "withdrawn":
            return {
                ...NOTHING,
                banner: { tone: "muted", text: "You withdrew your application" },
                blockedReason: closed,
                applyLabel: "Apply again",
            };
        case "accepted":
            // A current member never sees this card as an applicant; an ended membership can apply again.
            return {
                ...NOTHING,
                banner: status.membershipEnded
                    ? { tone: "muted", text: "You were a member" }
                    : { tone: "success", text: status.roleTitle ? `You joined as ${status.roleTitle}` : "Team member" },
                blockedReason: status.membershipEnded ? closed : null,
                applyLabel: "Apply again",
            };
        case "rejected": {
            const filled = status.decisionReason === "role_filled" || status.lifecycleStatus === "role_filled";
            const coolingDown = status.canReapply === false;
            return {
                ...NOTHING,
                appliedRowLabel: filled ? "Filled" : "Declined",
                banner: {
                    tone: filled ? "muted" : "danger",
                    text: filled ? "The role you applied for was filled" : "Your application was declined",
                    detail: filled ? undefined : reasonText,
                },
                blockedReason: closed ?? (coolingDown ? (status.waitTime ? `You can apply again in ${status.waitTime}.` : "You cannot apply again yet.") : null),
                applyLabel: "Apply again",
            };
        }
        case "proposed":
            return {
                ...NOTHING,
                banner: null,
                blockedReason: `You have a pending ${status.proposedRoleTitle || status.roleTitle || "Mentor"} invitation. Review or decline it to apply for other roles.`,
                applyLabel: "Apply",
            };
        default:
            return { ...NOTHING, banner: null, blockedReason: closed, applyLabel: "Apply" };
    }
}
