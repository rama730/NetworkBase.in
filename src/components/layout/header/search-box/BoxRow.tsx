"use client";

import { ArrowRight, FileText, Hash, MessageSquare, Plus, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { UserAvatar } from "@/components/ui/UserAvatar";
import WorkspaceAvatar from "@/components/workspaces/WorkspaceAvatar";
import { splitMatch } from "@/lib/search/global/rank";
import type { SearchHit } from "@/lib/search/global/types";

export const KIND_LABEL: Record<SearchHit["kind"], string> = {
    orgs: "Org", workspaces: "Workspace", posts: "Post", people: "Person", messages: "Message", goto: "Go to", channels: "Channel", scope: "Here",
};

/** The matched letters, marked (Dropdown board). */
export function Marked({ text, q }: { text: string; q: string }) {
    const { a, m, b } = splitMatch(text, q);
    return <>{a}{m ? <mark>{m}</mark> : null}{b}</>;
}

export function HitAvatar({ hit, size = 28 }: { hit: SearchHit; size?: number }) {
    if (hit.kind === "people") {
        return <UserAvatar identity={{ id: hit.meta.userId, fullName: hit.title, avatarUrl: hit.avatarUrl }} size={size} roundedClassName="rounded-[4px]" />;
    }
    if (hit.kind === "orgs" || hit.kind === "workspaces") {
        return (
            <span className="shrink-0" style={{ width: size, height: size }}>
                <WorkspaceAvatar project={{ id: String(hit.meta.entityId ?? hit.id), title: hit.title, coverImage: hit.avatarUrl, kind: hit.kind === "orgs" ? "organization" : "workspace" }} size="row" />
            </span>
        );
    }
    const Icon = hit.kind === "posts" ? FileText : hit.kind === "messages" ? MessageSquare : hit.kind === "channels" ? Hash
        : hit.meta.action ? Plus : hit.meta.control ? Settings2 : ArrowRight;
    return (
        <span className="nb-sx-icon" style={{ width: size, height: size }} aria-hidden="true">
            <Icon className="size-4" />
        </span>
    );
}

type RowProps = {
    hit: SearchHit;
    q: string;
    active: boolean;
    domId: string;
    onHover: () => void;
    onOpen: () => void;
    /** Connect / Message, or a setting's control. */
    action?: ReactNode;
};

export function BoxRow({ hit, q, active, domId, onHover, onOpen, action }: RowProps) {
    const second = hit.why ?? (hit.kind === "people" && hit.meta.relation ? `${hit.sub} · ${hit.meta.relation}` : hit.sub);
    // A listbox holds options only (axe): the row's action is an inline label here; the preview pane has the real buttons.
    return (
        <div role="none" data-active={active || undefined} className="nb-sx-row" onMouseMove={onHover}>
            <div id={domId} role="option" aria-selected={active} className="nb-sx-row-main" onClick={onOpen}>
                <HitAvatar hit={hit} />
                <span className="nb-sx-tx">
                    <span className="nb-sx-t1"><Marked text={hit.title} q={q} /></span>
                    <span className="nb-sx-t2">{hit.kind === "posts" || hit.kind === "messages" ? <Marked text={second} q={q} /> : second}</span>
                </span>
                <span className="nb-sx-end">
                    {action}
                    <span className="nb-sx-kind">{KIND_LABEL[hit.kind]}</span>
                    <kbd className="nb-sx-ret" aria-hidden="true">↵</kbd>
                </span>
            </div>
        </div>
    );
}
