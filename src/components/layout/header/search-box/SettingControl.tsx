"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useTheme } from "@/components/providers/theme-provider";
import { usePrivacySettings } from "@/hooks/useSettingsQueries";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";

const FIND_ME = [["everyone", "Everyone", "Everyone on NetworkBase"], ["my_places", "My places", "People in my workspaces and organizations"], ["connections", "Connections", "Only my connections"]] as const;

/** A setting changed right in its row (Go to: "Settings flip in place"); it saves and says so. */
/** `inline`: inside a search result row (an option), so plain labels that respond to a click; elsewhere, real buttons. */
export function SettingControl({ control, inline = false }: { control: "theme" | "findMe"; inline?: boolean }) {
    const { theme, setThemeWithTransition } = useTheme();
    const queryClient = useQueryClient();
    const [findMe, setFindMe] = useState<string | null>(null);
    const privacy = usePrivacySettings();
    const current = findMe ?? privacy.data?.settings.searchVisibility ?? null;

    const Tag = (inline ? "span" : "button") as "button";
    const tagProps = (pressed: boolean) => (inline ? { "data-pressed": pressed, "aria-hidden": true } : { type: "button" as const, "aria-pressed": pressed });
    if (control === "theme") {
        return (
            <span className="nb-sx-seg" {...(inline ? { "aria-hidden": true } : { role: "group", "aria-label": "Theme" })}>
                {(["dark", "light", "system"] as const).map((value) => (
                    <Tag key={value} {...tagProps(theme === value)} onClick={(event) => {
                        event.stopPropagation();
                        setThemeWithTransition(value);
                        toast.success(`Appearance: ${value} · saved`);
                    }}>{value[0]!.toUpperCase() + value.slice(1)}</Tag>
                ))}
            </span>
        );
    }
    return (
        <span className="nb-sx-seg" {...(inline ? { "aria-hidden": true } : { role: "group", "aria-label": "Who can find me in search" })}>
            {FIND_ME.map(([value, short, long]) => (
                <Tag key={value} {...tagProps(current === value)} onClick={async (event) => {
                    event.stopPropagation();
                    const response = await fetch("/api/v1/privacy", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ searchVisibility: value }) }).catch(() => null);
                    if (!response?.ok) { toast.error("Couldn’t save that. Open Settings › Privacy to try again."); return; }
                    setFindMe(value);
                    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.privacy() });
                    toast.success(`Who can find me in search: ${long} · saved`);
                }}>{short}</Tag>
            ))}
        </span>
    );
}
