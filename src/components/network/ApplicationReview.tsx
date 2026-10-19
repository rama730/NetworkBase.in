"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { DecisionDialog, type DecisionInput } from "@/components/applications/DecisionDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { conversationHref } from "@/lib/messaging/routes";
import { reopenState } from "@/lib/applications/utils";

type Details = { portfolioUrl?: string; availability?: string } | null;

/** How long a pending application has been waiting, once it is a day or more ("Waiting 3 days"). */
export function waitingLabel(createdAt: string | Date, nowMs: number = Date.now()) {
    const days = Math.floor((nowMs - new Date(createdAt).getTime()) / 86_400_000);
    return days >= 1 ? `Waiting ${days} ${days === 1 ? "day" : "days"}` : null;
}

/**
 * The reviewer's dialog for one pending application: what the applicant wrote, their details and profile, then
 * Accept or Decline (each with the shared reason / note dialog).
 */
export function ApplicationReview({
    applicantName,
    profileHref,
    headline,
    skills,
    roleTitle,
    projectTitle,
    message,
    details,
    channelId,
    onDecide,
}: {
    applicantName: string;
    profileHref: string;
    headline?: string | null;
    skills?: string[];
    roleTitle: string | null;
    projectTitle: string | null;
    message: string | null;
    details: Details;
    channelId: string | null;
    /** Resolves to an error message to show in the dialog, or null once the decision was saved. */
    onDecide: (mode: "accept" | "decline", input: DecisionInput) => Promise<string | null>;
}) {
    const [open, setOpen] = useState(false);
    const [deciding, setDeciding] = useState<"accept" | "decline" | null>(null);
    const chips = [...(skills ?? []).slice(0, 6), ...(details?.availability ? [details.availability] : [])];
    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <button type="button" className="nb-person-connect" aria-label={`Review application from ${applicantName}`}>Review</button>
                </DialogTrigger>
                <DialogContent className="nb-person-dialog">
                    <DialogHeader>
                        <DialogTitle>Application from {applicantName}</DialogTitle>
                        <DialogDescription>
                            {roleTitle ? `For ${roleTitle}` : "For a role"}{projectTitle ? ` · ${projectTitle}` : ""}
                        </DialogDescription>
                    </DialogHeader>
                    {headline ? <p className="nb-compact text-muted-foreground">{headline}</p> : null}
                    {chips.length ? (
                        <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="About the applicant">
                            {chips.map((chip) => <li key={chip} className="rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 text-muted-foreground">{chip}</li>)}
                        </ul>
                    ) : null}
                    <div className="max-h-[40dvh] overflow-y-auto rounded-[5px] border border-border bg-muted/20 p-3">
                        <p className="nb-compact whitespace-pre-wrap break-words">{message?.trim() || "No cover letter."}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                        <Link href={profileHref} className="text-primary hover:underline">View profile</Link>
                        {details?.portfolioUrl ? <a href={details.portfolioUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">Portfolio ↗</a> : null}
                        {channelId ? <Link href={conversationHref(channelId)} className="text-primary hover:underline">Open conversation</Link> : null}
                    </div>
                    <div className="flex gap-2">
                        <button type="button" className="nb-person-connect" onClick={() => { setOpen(false); setDeciding("accept"); }}>Accept</button>
                        <button type="button" className="nb-person-control" onClick={() => { setOpen(false); setDeciding("decline"); }}>Decline</button>
                    </div>
                </DialogContent>
            </Dialog>
            <DecisionDialog
                open={deciding !== null}
                mode={deciding ?? "decline"}
                applicantName={applicantName}
                roleTitle={roleTitle}
                onClose={() => setDeciding(null)}
                onConfirm={async (input) => {
                    const failure = await onDecide(deciding ?? "decline", input);
                    if (!failure) setDeciding(null);
                    return failure;
                }}
            />
        </>
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
