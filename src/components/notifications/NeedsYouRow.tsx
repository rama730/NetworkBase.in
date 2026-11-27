"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { NotificationWho } from "@/components/notifications/NotificationGlyph";
import { formatRelativeTimestamp } from "@/lib/notifications/presentation";
import type { NeedsYouItem, NotificationAct } from "@/lib/notifications/needs-you";
import type { NotificationGlyph, NotificationTone } from "@/lib/notifications/sentence";
import { waitingLabel } from "@/lib/notifications/tray-model";

const LOOK: Record<Exclude<NeedsYouItem["source"], "important">, [NotificationGlyph, NotificationTone]> = {
    review: ["branch", "info"], connection: ["person", "plain"], application: ["door", "plain"],
    agent_question: ["agent", "info"], agent_access: ["key", "info"],
};
const DONE_WORDS: Partial<Record<NotificationAct["act"], string>> = { accept: "Connected", allow: "Allowed once", answer: "Answered" };

/**
 * A Needs you row (notifications mix): a review, a request or an agent's question, answered right here with the
 * actions that already exist. It stays until it's answered, wherever that happens.
 */
export function NeedsYouRow({ item, now, active, onAct }: {
    item: NeedsYouItem;
    now: Date;
    active?: boolean;
    onAct: (item: NeedsYouItem, act: NotificationAct & { questionKey?: string }) => Promise<boolean>;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [glyph, tone] = LOOK[item.source as keyof typeof LOOK] ?? ["archive", "plain"];
    const waiting = waitingLabel(item.waitingSince, now);
    const run = async (act: NotificationAct) => {
        setBusy(act.label);
        const ok = await onAct(item, { ...act, questionKey: item.questionKey });
        setBusy(null);
        if (ok && (act.act === "accept" || act.act === "allow" || act.act === "answer")) setDone(act.act === "answer" ? `Answered: ${act.label}` : DONE_WORDS[act.act] ?? "Done");
    };
    const button = (act: NotificationAct, kind: "primary" | "plain" | "ghost", extra?: ReactNode) => act.act === "open" ? (
        <Link key={act.label} href={item.href} prefetch={false} className="nb-nt-btn" data-kind={kind === "plain" ? undefined : kind}>{act.label}</Link>
    ) : (
        <button key={act.label + (act.value ?? "")} type="button" className="nb-nt-btn" data-kind={kind === "plain" ? undefined : kind} disabled={Boolean(busy)} onClick={() => void run(act)}>
            {busy === act.label ? "…" : act.label}{extra}
        </button>
    );

    return (
        <div className="nb-nt-row" data-unread data-active={active || undefined} data-needs-you={item.source} tabIndex={-1}>
            <Link href={item.href} prefetch={false} className="flex-none rounded-[5px]" aria-label={`Needs you: ${item.sentence.actor}${item.sentence.verb}${item.sentence.object}`} tabIndex={-1}>
                <NotificationWho actor={item.actor} glyph={glyph} tone={tone} />
            </Link>
            <span className="nb-nt-tx">
                <Link href={item.href} prefetch={false} className="nb-nt-t1 nb-compact">
                    {item.sentence.actor ? <b>{item.sentence.actor}</b> : null}{item.sentence.verb}{item.sentence.object ? <b>{item.sentence.object}</b> : null}
                </Link>
                {item.snippet ? <span className="nb-nt-snip">{item.snippet}</span> : null}
                <span className="nb-nt-meta nb-meta">
                    {waiting ? <span className="nb-nt-wait">{waiting}</span> : null}
                    {item.context ? <span>{waiting ? `· ${item.context}` : item.context}</span> : null}
                </span>
                {done ? (
                    <span className="nb-nt-acts"><span className="nb-nt-ok"><Check className="size-4" aria-hidden="true" />{done}</span>{item.source === "connection" ? <Link href={item.href} prefetch={false} className="nb-nt-btn">Message</Link> : null}</span>
                ) : (
                    <span className="nb-nt-acts">
                        {(item.options ?? []).map((option) => button({ act: "answer", label: option.label, value: option.value }, "plain", option.recommended ? <span className="nb-nt-rec">Recommended</span> : null))}
                        {item.primary ? button(item.primary, "primary") : null}
                        {item.secondary ? button(item.secondary, "ghost") : null}
                    </span>
                )}
            </span>
            <span className="nb-nt-side">
                <span className="nb-nt-when nb-meta">{formatRelativeTimestamp(item.waitingSince) ?? "now"}</span>
                <span className="nb-nt-mark" aria-hidden="true" />
            </span>
        </div>
    );
}
