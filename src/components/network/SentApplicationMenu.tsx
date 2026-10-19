"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { conversationHref } from "@/lib/messaging/routes";

const LABEL = { pending: "Applied", accepted: "Accepted", rejected: "Declined" } as const;

/** The applicant's handle on one application they sent: where it stands, its thread, and Withdraw while it is pending. */
export function SentApplicationMenu({ status, name, projectHref, channelId, onWithdraw }: {
    status: keyof typeof LABEL;
    name: string;
    projectHref: string;
    channelId: string | null;
    onWithdraw: () => void;
}) {
    return <DropdownMenu><DropdownMenuTrigger asChild>
        <button className="nb-person-control" aria-label={`${LABEL[status]}: options for your application to ${name}`}>{LABEL[status]}<ChevronDown className="size-3" aria-hidden="true" /></button>
    </DropdownMenuTrigger><DropdownMenuContent align="end">
        {channelId ? <DropdownMenuItem asChild><Link href={conversationHref(channelId)}>Open conversation</Link></DropdownMenuItem> : null}
        <DropdownMenuItem asChild><Link href={projectHref}>View project</Link></DropdownMenuItem>
        {status === "pending" ? <DropdownMenuItem onSelect={onWithdraw}>Withdraw application</DropdownMenuItem> : null}
    </DropdownMenuContent></DropdownMenu>;
}
