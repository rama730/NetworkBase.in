'use client';

import { Loader2 } from "lucide-react";
import {
    WORKSPACE_PUBLIC_TAB_DESCRIPTIONS,
    WORKSPACE_PUBLIC_TAB_LABELS,
    type WorkspacePublicTabId,
    type WorkspacePublicTabVisibility,
} from "@/lib/workspaces/settings-policies";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

const PUBLIC_TAB_ORDER: WorkspacePublicTabId[] = ["dashboard", "readme", "updates", "sprints", "tasks", "files"];

export function PublicTabVisibilityEditor({
    value,
    onChange,
    disabled,
    savingTabId,
}: {
    value: WorkspacePublicTabVisibility;
    onChange: (tabId: WorkspacePublicTabId, enabled: boolean) => void;
    disabled?: boolean;
    savingTabId?: WorkspacePublicTabId | null;
}) {
    return (
        <div className="divide-y divide-border">
            {PUBLIC_TAB_ORDER.map((tabId) => {
                const isEnabled = Boolean(value[tabId]);
                const isSaving = savingTabId === tabId;
                return (
                    <div
                        key={tabId}
                        className="flex min-h-16 items-start justify-between gap-4 py-3 sm:items-center"
                    >
                        <div className="min-w-0 flex-1">
                            <p className="nb-ui-label text-foreground">{WORKSPACE_PUBLIC_TAB_LABELS[tabId]}</p>
                            <p className="mt-1 nb-compact text-muted-foreground leading-relaxed">{WORKSPACE_PUBLIC_TAB_DESCRIPTIONS[tabId]}</p>
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
                                aria-label={`Toggle public ${WORKSPACE_PUBLIC_TAB_LABELS[tabId]} visibility`}
                                onCheckedChange={(checked) => onChange(tabId, checked)}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
