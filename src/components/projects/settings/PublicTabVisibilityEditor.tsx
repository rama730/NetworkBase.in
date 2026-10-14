'use client';

import { Loader2 } from "lucide-react";
import {
    PROJECT_PUBLIC_TAB_DESCRIPTIONS,
    PROJECT_PUBLIC_TAB_LABELS,
    type ProjectPublicTabId,
    type ProjectPublicTabVisibility,
} from "@/lib/projects/settings-policies";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

const PUBLIC_TAB_ORDER: ProjectPublicTabId[] = ["dashboard", "readme", "updates", "sprints", "tasks", "files"];

export function PublicTabVisibilityEditor({
    value,
    onChange,
    disabled,
    savingTabId,
}: {
    value: ProjectPublicTabVisibility;
    onChange: (tabId: ProjectPublicTabId, enabled: boolean) => void;
    disabled?: boolean;
    savingTabId?: ProjectPublicTabId | null;
}) {
    return (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {PUBLIC_TAB_ORDER.map((tabId) => {
                const isEnabled = Boolean(value[tabId]);
                const isSaving = savingTabId === tabId;
                return (
                    <div
                        key={tabId}
                        className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/20"
                    >
                        <div className="min-w-0 flex-1">
                            <p className="nb-ui-label text-foreground">{PROJECT_PUBLIC_TAB_LABELS[tabId]}</p>
                            <p className="mt-1 nb-compact text-muted-foreground leading-relaxed">{PROJECT_PUBLIC_TAB_DESCRIPTIONS[tabId]}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            <span className="nb-meta text-muted-foreground select-none w-6 text-right flex items-center justify-end">
                                {isSaving ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                ) : isEnabled ? (
                                    "On"
                                ) : (
                                    "Off"
                                )}
                            </span>
                            <SettingsSwitch
                                checked={isEnabled}
                                disabled={disabled || Boolean(savingTabId)}
                                aria-label={`Toggle public ${PROJECT_PUBLIC_TAB_LABELS[tabId]} visibility`}
                                onCheckedChange={(checked) => onChange(tabId, checked)}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
