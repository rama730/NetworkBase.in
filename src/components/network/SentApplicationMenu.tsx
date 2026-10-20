"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { conversationHref } from "@/lib/messaging/routes";

const LABEL = { pending: "Applied", accepted: "Accepted", rejected: "Declined", withdrawn: "Withdrawn" } as const;

/** A decline the project caused is not a "Declined": the role filled, the role went away, or the project closed. */
function labelFor(status: keyof typeof LABEL, reasonCode: string | null) {
    if (status !== "rejected") return LABEL[status];
    if (reasonCode === "role_filled") return "Role filled";
    if (reasonCode === "project_closed" || reasonCode === "role_removed") return "Closed";
    return LABEL.rejected;
}

/** The applicant's handle on one application they sent: where it stands, its thread, and Withdraw while it is pending. */
export function SentApplicationMenu({ status, reasonCode = null, name, projectHref, channelId, onWithdraw }: {
    status: keyof typeof LABEL;
    reasonCode?: string | null;
    name: string;
    projectHref: string;
    channelId: string | null;
    onWithdraw: () => void;
}) {
    return <DropdownMenu><DropdownMenuTrigger asChild>
        <button className="nb-person-control" aria-label={`${labelFor(status, reasonCode)}: options for your application to ${name}`}>{labelFor(status, reasonCode)}<ChevronDown className="size-3" aria-hidden="true" /></button>
    </DropdownMenuTrigger><DropdownMenuContent align="end">
        {channelId ? <DropdownMenuItem asChild><Link href={conversationHref(channelId)}>Open conversation</Link></DropdownMenuItem> : null}
        <DropdownMenuItem asChild><Link href={projectHref}>View project</Link></DropdownMenuItem>
        {status === "pending" ? <DropdownMenuItem onSelect={onWithdraw}>Withdraw application</DropdownMenuItem> : null}
    </DropdownMenuContent></DropdownMenu>;
}
