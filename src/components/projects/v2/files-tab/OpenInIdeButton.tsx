"use client";

import React, { useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronDown,
  Check,
  ExternalLink,
  Laptop,
  Plus,
  KeyRound,
  Sparkles,
  ShoppingBag,
} from "lucide-react";

import {
  SUPPORTED_IDES,
  SupportedIde,
  IdeDefinition,
  buildIdeLaunchUri,
  buildIdeMarketplaceUri,
  dispatchIdeProtocol,
  resolveIdeFromSession,
  getPreferredIde,
  setPreferredIde,
} from "@/lib/extension/ide-protocol";
import { useExtensionSessionsData } from "@/hooks/useSettingsQueries";
import { useLaptopInstalledIdes } from "@/hooks/useLaptopInstalledIdes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CurrentLocation } from "./navigation";
import type { ExtensionSessionData } from "@/types/settingsTypes";

interface OpenInIdeButtonProps {
  projectId: string;
  projectSlug?: string;
  location?: CurrentLocation | null;
  taskId?: string | null;
  className?: string;
}

export function OpenInIdeButton({
  projectId,
  projectSlug,
  location,
  taskId,
  className = "",
}: OpenInIdeButtonProps): React.JSX.Element {
  const { data: sessionData } = useExtensionSessionsData();
  const { installedList, otherList, hasDetectedInstalled, platform } = useLaptopInstalledIdes();
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackIde, setFallbackIde] = useState<IdeDefinition>(SUPPORTED_IDES.cursor);
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);


  // Filter active authenticated sessions
  const activeSessions = useMemo(() => {
    return (sessionData?.sessions || []).filter(
      (s) => s.clientVersion !== "pending" && (s.editorPlatform || s.editorName),
    );
  }, [sessionData?.sessions]);

  // Map to connected IDE definitions (deduplicated)
  const connectedIdes = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ ide: IdeDefinition; session: ExtensionSessionData }> = [];
    for (const session of activeSessions) {
      const ideKey = resolveIdeFromSession(session);
      const def = SUPPORTED_IDES[ideKey];
      if (def && !seen.has(ideKey)) {
        seen.add(ideKey);
        list.push({ ide: def, session });
      }
    }
    return list;
  }, [activeSessions]);

  const hasConnected = connectedIdes.length > 0;

  // Active preferred connected IDE
  const activeConnectedIde = useMemo(() => {
    if (!hasConnected) return null;
    const preferred = getPreferredIde();
    const found = connectedIdes.find((c) => c.ide.id === preferred);
    return found ? found.ide : (connectedIdes[0]?.ide ?? SUPPORTED_IDES.cursor);
  }, [hasConnected, connectedIdes]);

  // Performs actual protocol dispatch
  const executeDispatch = (ideId: SupportedIde, action: "workspace" | "marketplace") => {
    const def = SUPPORTED_IDES[ideId] || SUPPORTED_IDES.cursor;
    setFallbackIde(def);
    setPreferredIde(ideId);

    if (action === "workspace") {
      const isFile = location?.type === "file";
      const fileId = isFile ? location.node.id : undefined;
      const filePath = isFile ? location.node.path : undefined;

      const uri = buildIdeLaunchUri({
        ide: ideId,
        projectId,
        projectSlug,
        fileId,
        filePath,
        taskId: taskId || undefined,
      });

      dispatchIdeProtocol(uri, () => {
        setFallbackOpen(true);
      });
    } else {
      const marketplaceUri = buildIdeMarketplaceUri(ideId);

      dispatchIdeProtocol(marketplaceUri, () => {
        setFallbackOpen(true);
      });
    }
  };

  // The browser shows its own "open this app?" prompt; there is nothing to imitate or pre-announce.
  const initiateLaunch = (ideId: SupportedIde, action: "workspace" | "marketplace") => executeDispatch(ideId, action);

  const platformLabel = platform === "darwin" ? "Mac" : platform === "win32" ? "PC" : "Laptop";

  return (
    <>
      <div
        data-testid="open-in-ide-tool"
        className={`inline-flex shrink-0 items-center rounded-[6px] border border-border bg-background shadow-none ${className}`}
      >
        {/* CASE A: No extensions connected yet -> Show Connect Desktop IDE with editor picker */}
        {!hasConnected ? (
          <DropdownMenu open={connectMenuOpen} onOpenChange={setConnectMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Connect desktop editor"
                aria-label="Connect desktop editor"
                className="flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] rounded-[6px]"
              >
                <Laptop className="size-3.5 shrink-0 text-[#2563C9]" />
                <span>Connect Desktop IDE</span>
                <ChevronDown className="size-3 text-muted-foreground ml-0.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-[380px] overflow-y-auto">
              {hasDetectedInstalled ? (
                <>
                  <DropdownMenuLabel className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    <span>Installed on Your {platformLabel}</span>
                    <span className="rounded-[4px] bg-emerald-100 dark:bg-emerald-950/80 px-1.5 py-0.5 text-[11px] font-medium lowercase text-emerald-700 dark:text-emerald-300">
                      detected
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {installedList.map((ide) => (
                    <DropdownMenuItem
                      key={ide.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        setConnectMenuOpen(false);
                        setTimeout(() => initiateLaunch(ide.id, "marketplace"), 50);
                      }}
                      className="flex items-center justify-between gap-2 cursor-pointer text-xs py-2 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Image
                          src={ide.icon}
                          alt=""
                          width={16}
                          height={16}
                          unoptimized
                          className="size-4 shrink-0 object-contain"
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-foreground truncate">
                            {ide.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {ide.description}
                          </span>
                        </div>
                      </div>
                      <span className="rounded-[4px] bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 shrink-0">
                        Installed
                      </span>
                    </DropdownMenuItem>
                  ))}

                  {otherList.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Other Supported Editors
                      </DropdownMenuLabel>
                      {otherList.map((ide) => (
                        <DropdownMenuItem
                          key={ide.id}
                          onSelect={(e) => {
                            e.preventDefault();
                            setConnectMenuOpen(false);
                            setTimeout(() => initiateLaunch(ide.id, "marketplace"), 50);
                          }}
                          className="flex items-center justify-between gap-2 cursor-pointer text-xs py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Image
                              src={ide.icon}
                              alt=""
                              width={16}
                              height={16}
                              unoptimized
                              className="size-4 shrink-0 object-contain"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium text-foreground truncate">
                                {ide.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {ide.description}
                              </span>
                            </div>
                          </div>
                          <ShoppingBag className="size-3 text-muted-foreground shrink-0" />
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <>
                  <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Choose Laptop Editor
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(Object.keys(SUPPORTED_IDES) as SupportedIde[]).map((id) => {
                    const ide = SUPPORTED_IDES[id];
                    return (
                      <DropdownMenuItem
                        key={id}
                        onSelect={(e) => {
                          e.preventDefault();
                          setConnectMenuOpen(false);
                          setTimeout(() => initiateLaunch(id, "marketplace"), 50);
                        }}
                        className="flex items-center justify-between gap-2 cursor-pointer text-xs py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Image
                            src={ide.icon}
                            alt=""
                            width={16}
                            height={16}
                            unoptimized
                            className="size-4 shrink-0 object-contain"
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-foreground truncate">
                              {ide.name}
                            </span>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {ide.description}
                            </span>
                          </div>
                        </div>
                        <ShoppingBag className="size-3 text-muted-foreground shrink-0" />
                      </DropdownMenuItem>
                    );
                  })}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : connectedIdes.length === 1 && connectedIdes[0] ? (
          /* CASE B: Exactly 1 extension connected -> Clean 1-click button with ONLY connected IDE */
          <button
            type="button"
            onClick={() => connectedIdes[0] && initiateLaunch(connectedIdes[0].ide.id, "workspace")}
            title={`Open in ${connectedIdes[0].ide.name} (Connected)`}
            aria-label={`Open in ${connectedIdes[0].ide.name}`}
            className="flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] rounded-[6px]"
          >
            <Image
              src={connectedIdes[0].ide.icon}
              alt=""
              width={14}
              height={14}
              unoptimized
              className="size-3.5 shrink-0 object-contain"
            />
            <span className="truncate">Open in {connectedIdes[0].ide.name}</span>
            <span
              className="size-2 shrink-0 rounded-[2px] bg-emerald-500 ring-1 ring-emerald-500/20"
              title="Connected"
            />
          </button>
        ) : (
          /* CASE C: Multiple extensions connected -> Dropdown shows ONLY connected IDEs */
          <>
            <button
              type="button"
              onClick={() => activeConnectedIde && initiateLaunch(activeConnectedIde.id, "workspace")}
              title={`Open in ${activeConnectedIde?.name || "IDE"} (Connected)`}
              aria-label={`Open in ${activeConnectedIde?.name || "IDE"}`}
              className="flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] rounded-l-[6px]"
            >
              {activeConnectedIde && (
                <Image
                  src={activeConnectedIde.icon}
                  alt=""
                  width={14}
                  height={14}
                  unoptimized
                  className="size-3.5 shrink-0 object-contain"
                />
              )}
              <span className="truncate">Open in {activeConnectedIde?.name}</span>
              <span
                className="size-2 shrink-0 rounded-[2px] bg-emerald-500 ring-1 ring-emerald-500/20"
                title="Connected"
              />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Choose connected editor"
                  className="flex min-h-9 w-6 items-center justify-center border-l border-border px-1 hover:bg-muted rounded-r-[6px]"
                >
                  <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Connected Editors
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {connectedIdes.map(({ ide, session }) => {
                  const isSelected = ide.id === activeConnectedIde?.id;
                  const platform = session.editorPlatform
                    ? session.editorPlatform === "darwin"
                      ? "macOS"
                      : session.editorPlatform === "win32"
                        ? "Windows"
                        : "Linux"
                    : "Connected";

                  return (
                    <DropdownMenuItem
                      key={ide.id}
                      onClick={() => initiateLaunch(ide.id, "workspace")}
                      className="flex items-center justify-between gap-2 cursor-pointer text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Image
                          src={ide.icon}
                          alt=""
                          width={16}
                          height={16}
                          unoptimized
                          className="size-4 shrink-0 object-contain"
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-foreground truncate">
                            {ide.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {platform}
                          </span>
                        </div>
                      </div>
                      {isSelected && <Check className="size-3.5 text-[#2563C9] shrink-0" />}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConnectMenuOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-[#2563C9] cursor-pointer"
                >
                  <Plus className="size-3.5" />
                  <span>Connect another editor</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Fallback Setup Modal */}
      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="flex size-9 items-center justify-center rounded-[8px] bg-[#FCF0EA] dark:bg-[#D14E24]/20 text-[#D14E24]">
                <Image
                  src={fallbackIde.icon}
                  alt=""
                  width={20}
                  height={20}
                  unoptimized
                  className="size-5 object-contain"
                />
              </div>
              <DialogTitle className="text-base font-semibold">
                Install Extension in {fallbackIde.name}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              If nothing opened, install the NetworkBase WorkSpace extension in {fallbackIde.name}, then try again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="rounded-[8px] border border-border bg-muted/40 p-3 space-y-2">
              <div className="font-medium text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-[#D14E24]" />
                NetworkBase Virtual Workspace
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Edit files directly with live cloud sync, zero clone overhead, and seamless task tracking in your editor.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <p className="font-medium text-foreground">
                Quick Setup:
              </p>
              <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                <li>Search for <code className="rounded-[4px] bg-muted px-1 py-0.5 text-foreground font-mono text-[11px]">NetworkBase Workspace</code> in your editor extensions.</li>
                <li>Click <strong>Install</strong>.</li>
                <li>Once installed, click <strong>Open in {fallbackIde.name}</strong> to connect automatically.</li>
              </ol>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="text-xs gap-1.5"
            >
              <Link href="/settings?tab=integrations">
                <KeyRound className="size-3.5" />
                Extension Settings
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => executeDispatch(fallbackIde.id, "marketplace")}
              className="gap-1.5 bg-primary text-xs text-primary-foreground transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"
            >
              <ExternalLink className="size-3.5" />
              Open Marketplace in {fallbackIde.name}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Phones reach the desktop IDE handoff from ⋯ menus; this sheet hosts the same button. `layered` lifts it above the task panel. */
export function OpenInIdeSheet({
  open,
  onOpenChange,
  layered = false,
  ...buttonProps
}: OpenInIdeButtonProps & { open: boolean; onOpenChange: (open: boolean) => void; layered?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent overlayClassName={layered ? "z-[220]" : undefined} className={layered ? "z-[221] md:hidden" : "md:hidden"}>
        <DialogTitle className="nb-card-title">Connect desktop IDE</DialogTitle>
        <DialogDescription className="nb-compact text-muted-foreground">Open this work in your desktop editor.</DialogDescription>
        <OpenInIdeButton {...buttonProps} />
      </DialogContent>
    </Dialog>
  );
}
