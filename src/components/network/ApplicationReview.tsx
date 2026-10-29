"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";

import { getApplicationAlignmentAction } from "@/app/actions/applications";
import type { AttributeAlignment } from "@/app/actions/matchmaking/resolver";
import { DecisionForm, type DecisionInput } from "@/components/applications/DecisionDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { conversationHref } from "@/lib/messaging/routes";
import { reopenState, safeHttpUrl } from "@/lib/applications/utils";

type Details = { portfolioUrl?: string; availability?: string } | null;

/** The three profile-vs-role checks, as the invite form shows them. */
function FitSummary({ fit }: { fit: AttributeAlignment }) {
    const required = fit.skillsMatch.matched.length + fit.skillsMatch.missing.length;
    const checks: Array<[string, boolean]> = [
        ["Commitment", fit.commitmentMatch.aligns],
        ["Capacity", fit.capacityMatch.aligns],
        ["Experience", fit.experienceMatch.aligns],
    ];
    return (
        <div className="space-y-1.5 rounded-[5px] border border-border bg-muted/30 p-3 text-xs text-muted-foreground" aria-label="How they fit the role">
            {required ? <p>Has {fit.skillsMatch.matched.length} of {required} required skills{fit.skillsMatch.missing.length ? ` (missing ${fit.skillsMatch.missing.slice(0, 3).join(", ")})` : ""}</p> : null}
            <p className="flex flex-wrap gap-x-4 gap-y-1">
                {checks.map(([label, aligns]) => (
                    <span key={label} className="inline-flex items-center gap-1">
                        {aligns ? <Check aria-hidden="true" className="size-3 text-[var(--status-success,#2F6B4F)]" /> : null}
                        {label}{aligns ? "" : " not stated"}
                    </span>
                ))}
            </p>
        </div>
    );
}

/**
 * The reviewer's dialog for one pending application, in one place: what the applicant wrote, their details, profile and how they
 * fit the role, then Accept or Decline as a second step inside the same dialog (focus never drops).
 */
export function ApplicationReview({
    applicationId,
    applicantName,
    profileHref,
    headline,
    location,
    skills,
    roleTitle,
    projectTitle,
    message,
    details,
    channelId,
    onDecide,
}: {
    applicationId: string;
    applicantName: string;
    profileHref: string;
    headline?: string | null;
    location?: string | null;
    skills?: string[];
    roleTitle: string | null;
    projectTitle: string | null;
    message: string | null;
    details: Details;
    channelId: string | null;
    /** Resolves to an error message to show in the dialog, or null once the decision was saved. */
    onDecide: (mode: "accept" | "decline", input: DecisionInput) => Promise<string | null>;
}) {
    const phone = useMediaQuery("(max-width: 639px)");
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<"review" | "accept" | "decline">("review");
    const [fit, setFit] = useState<AttributeAlignment | null>(null);
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        void getApplicationAlignmentAction(applicationId).then((result) => { if (!cancelled) setFit(result); });
        return () => { cancelled = true; };
    }, [applicationId, open]);
    const chips = [...(skills ?? []).slice(0, 6), ...(details?.availability ? [details.availability] : [])];
    const portfolio = safeHttpUrl(details?.portfolioUrl);
    return (
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setStep("review"); }}>
            <DialogTrigger asChild>
                <button type="button" className="nb-person-connect" aria-label={`Review application from ${applicantName}`}>Review</button>
            </DialogTrigger>
            <DialogContent presentation={phone ? "bottom-sheet" : "center"} className={phone ? "p-4" : "nb-person-dialog"}>
                {step === "review" ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Application from {applicantName}</DialogTitle>
                            <DialogDescription>
                                {roleTitle ? `For ${roleTitle}` : "For a role"}{projectTitle ? ` · ${projectTitle}` : ""}
                            </DialogDescription>
                        </DialogHeader>
                        {headline || location ? <p className="nb-compact text-muted-foreground">{[headline, location].filter(Boolean).join(" · ")}</p> : null}
                        {chips.length ? (
                            <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="About the applicant">
                                {chips.map((chip) => <li key={chip} className="rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 text-muted-foreground">{chip}</li>)}
                            </ul>
                        ) : null}
                        {fit ? <FitSummary fit={fit} /> : null}
                        <div className="max-h-[40dvh] overflow-y-auto rounded-[5px] border border-border bg-muted/20 p-3">
                            <p className="nb-compact whitespace-pre-wrap break-words">{message?.trim() || "No message included"}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                            <Link href={profileHref} className="text-primary hover:underline">View profile</Link>
                            {portfolio ? <a href={portfolio} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">Portfolio ↗</a> : null}
                            {channelId ? <Link href={conversationHref(channelId)} className="text-primary hover:underline">Open conversation</Link> : null}
                        </div>
                        <div className="flex gap-2">
                            <button type="button" className="nb-person-connect" onClick={() => setStep("accept")}>Accept</button>
                            <button type="button" className="nb-person-control" onClick={() => setStep("decline")}>Decline</button>
                        </div>
                    </>
                ) : (
                    <DecisionForm
                        mode={step}
                        applicantName={applicantName}
                        roleTitle={roleTitle}
                        onCancel={() => setStep("review")}
                        onConfirm={async (input) => {
                            const failure = await onDecide(step, input);
                            if (!failure) { setOpen(false); setStep("review"); }
                            return failure;
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

const STATUS_WORD = { accepted: "Accepted", rejected: "Declined", withdrawn: "Withdrawn" } as const;

/** A decided application in the Decided list: where it ended up, its thread, and a fresh decline can be reopened. */
export function DecidedApplicationMenu({
    status,
    applicantName,
    profileHref,
    channelId,
    decidedAt,
    reasonCode,
    roleRemoved,
    onReopen,
}: {
    status: keyof typeof STATUS_WORD;
    applicantName: string;
    profileHref: string;
    channelId: string | null;
    decidedAt: string;
    reasonCode: string | null;
    roleRemoved: boolean;
    onReopen: () => void;
}) {
    const reopen = reopenState({ status: status === "rejected" ? "rejected" : status, decision_at: decidedAt, decision_reason_code: reasonCode, role_removed: roleRemoved });
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className="nb-person-control" aria-label={`${STATUS_WORD[status]}: options for ${applicantName}'s application`}>
                    {STATUS_WORD[status]}<ChevronDown className="size-3" aria-hidden="true" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {channelId ? <DropdownMenuItem asChild><Link href={conversationHref(channelId)}>Open conversation</Link></DropdownMenuItem> : null}
                <DropdownMenuItem asChild><Link href={profileHref}>View profile</Link></DropdownMenuItem>
                {reopen.canReopen ? <DropdownMenuItem onSelect={onReopen}>Reopen · {reopen.minutesLeft} min left</DropdownMenuItem> : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
