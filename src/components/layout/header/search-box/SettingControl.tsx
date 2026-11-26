"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useTheme } from "@/components/providers/theme-provider";
import { usePrivacySettings } from "@/hooks/useSettingsQueries";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";

const FIND_ME = [["everyone", "Everyone", "Everyone on NetworkBase"], ["my_places", "My places", "People in my workspaces and organizations"], ["connections", "Connections", "Only my connections"]] as const;

/** A setting changed right in its row (Go to: "Settings flip in place"); it saves and says so. */
export function SettingControl({ control }: { control: "theme" | "findMe" }) {
    const { theme, setThemeWithTransition } = useTheme();
    const queryClient = useQueryClient();
    const [findMe, setFindMe] = useState<string | null>(null);
    const privacy = usePrivacySettings();
    const current = findMe ?? privacy.data?.settings.searchVisibility ?? null;

    if (control === "theme") {
        return (
            <span className="nb-sx-seg" role="group" aria-label="Theme">
                {(["dark", "light", "system"] as const).map((value) => (
                    <button key={value} type="button" aria-pressed={theme === value} onClick={(event) => {
                        event.stopPropagation();
                        setThemeWithTransition(value);
                        toast.success(`Appearance: ${value} · saved`);
                    }}>{value[0]!.toUpperCase() + value.slice(1)}</button>
                ))}
            </span>
        );
    }
    return (
        <span className="nb-sx-seg" role="group" aria-label="Who can find me in search">
            {FIND_ME.map(([value, short, long]) => (
                <button key={value} type="button" aria-pressed={current === value} onClick={async (event) => {
                    event.stopPropagation();
                    const response = await fetch("/api/v1/privacy", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ searchVisibility: value }) }).catch(() => null);
                    if (!response?.ok) { toast.error("Couldn’t save that. Open Settings › Privacy to try again."); return; }
                    setFindMe(value);
                    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.privacy() });
                    toast.success(`Who can find me in search: ${long} · saved`);
                }}>{short}</button>
            ))}
        </span>
    );
}
