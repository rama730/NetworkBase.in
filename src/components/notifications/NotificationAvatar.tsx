import { BrandMark } from "@/components/brand/BrandMark";
import { UserAvatar } from "@/components/ui/UserAvatar";

/** A person's picture, or the NetworkBase mark for a notice no person sent: a report's outcome, a post's grouped activity. */
export function NotificationAvatar({ actorUserId, actorName, fallbackName, avatarUrl, size }: {
    actorUserId: string | null;
    actorName: string | null | undefined;
    fallbackName?: string | null;
    avatarUrl: string | null | undefined;
    size: number;
}) {
    if (!actorUserId && !actorName) {
        return (
            <span className="grid place-items-center rounded-md border border-border/80 bg-card" style={{ width: size, height: size }}>
                <BrandMark variant="dot" size={Math.round(size * 0.55)} />
            </span>
        );
    }
    return (
        <UserAvatar
            identity={{ id: actorUserId, fullName: actorName ?? fallbackName ?? "Member", avatarUrl }}
            size={size}
            className="border border-border/80"
            fallbackClassName="nb-ui-label"
        />
    );
}
