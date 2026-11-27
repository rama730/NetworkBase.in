import {
    Archive, AtSign, BadgeCheck, Bot, Building2, Check, Clock, DoorOpen, FileText, Flag, GitBranch, GitMerge, Heart,
    KeyRound, Megaphone, MessageSquare, Search, ShieldAlert, SquareCheck, UserPlus, X, type LucideIcon,
} from "lucide-react";

import { NotificationAvatar } from "@/components/notifications/NotificationAvatar";
import type { NotificationGlyph as Glyph, NotificationTone } from "@/lib/notifications/sentence";

const ICONS: Record<Glyph, LucideIcon> = {
    branch: GitBranch, merge: GitMerge, check: Check, x: X, file: FileText, task: SquareCheck, clock: Clock, at: AtSign,
    chat: MessageSquare, person: UserPlus, door: DoorOpen, org: Building2, megaphone: Megaphone, agent: Bot, key: KeyRound,
    shield: ShieldAlert, sprint: Flag, search: Search, heart: Heart, role: BadgeCheck, archive: Archive,
};

export function GlyphIcon({ glyph }: { glyph: Glyph }) {
    const Icon = ICONS[glyph];
    return <Icon aria-hidden="true" strokeWidth={1.75} />;
}

/**
 * Who (notifications mix): the person's 34px square avatar with the kind on its corner, or, when no person acted,
 * a 34px tile with a 14px glyph in its family's tint. A thread shows its count on the corner instead.
 */
export function NotificationWho({ actor, glyph, tone, count }: {
    actor: { id: string | null; name: string | null; avatarUrl: string | null } | null;
    glyph: Glyph;
    tone: NotificationTone;
    count?: number;
}) {
    if (!actor || (!actor.id && !actor.name)) {
        return (
            <span className="nb-nt-who">
                <span className="nb-nt-tile" data-tone={tone}><GlyphIcon glyph={glyph} /></span>
                {count && count > 1 ? <span className="nb-nt-corner" aria-hidden="true">{count}</span> : null}
            </span>
        );
    }
    return (
        <span className="nb-nt-who">
            <NotificationAvatar actorUserId={actor.id} actorName={actor.name} avatarUrl={actor.avatarUrl} size={34} />
            <span className="nb-nt-corner" aria-hidden="true">{count && count > 1 ? count : <GlyphIcon glyph={glyph} />}</span>
        </span>
    );
}
