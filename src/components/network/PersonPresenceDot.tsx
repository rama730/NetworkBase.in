import { formatLastActive } from "@/lib/ui/date-formatting";

type PersonPresenceDotProps = {
    lastActiveAt?: string | null;
    compact?: boolean;
};

export function PersonPresenceDot({ lastActiveAt, compact = false }: PersonPresenceDotProps) {
    const label = formatLastActive(lastActiveAt) ?? "Offline";
    const tone = label === "Active today"
        ? "var(--status-success)"
        : label === "Active this week"
            ? "var(--status-warning)"
            : "var(--muted-foreground)";

    return (
        <span
            className={compact ? "nb-person-presence-dot nb-person-presence-dot--compact" : "nb-person-presence-dot"}
            style={{ backgroundColor: tone }}
            aria-label={label}
            title={label}
        />
    );
}
