"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Copy, ExternalLink, Laptop, KeyRound, Terminal } from "lucide-react";
import {
  SUPPORTED_IDES,
  type SupportedIde,
  type IdeDefinition,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/lib/feedback";
import { DesktopIdePicker } from "./DesktopIdePicker";
import { IdeWorkspacePicker, type IdeWorkspace } from "./IdeWorkspacePicker";
import type { CurrentLocation } from "./navigation";

interface OpenInIdeButtonProps {
  /** My Work asks which project to open when there is no project context. */
  projectId?: string;
  projectSlug?: string;
  location?: CurrentLocation | null;
  taskId?: string | null;
  className?: string;
  /** Report §24.2: organization members open files here but can't change them; the button and picker say so. */
  readOnlyNote?: string | null;
}

const controlClass =
  "inline-flex h-full min-w-0 items-center justify-center gap-[7px] whitespace-nowrap px-2.5 text-[13px] font-medium leading-[1.2] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60";

export function OpenInIdeButton({
  projectId,
  projectSlug,
  location,
  taskId,
  className,
  readOnlyNote = null,
}: OpenInIdeButtonProps): React.JSX.Element {
  const sessions = useExtensionSessionsData();
  const {
    installedList,
    platform,
    isLoading: detectingEditors,
  } = useLaptopInstalledIdes();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectAnother, setConnectAnother] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackIde, setFallbackIde] = useState<IdeDefinition>(
    SUPPORTED_IDES.cursor,
  );
  const [preferred, setPreferred] = useState(getPreferredIde);
  const [projectPickerIde, setProjectPickerIde] = useState<SupportedIde | null>(
    null,
  );
  const [copiedCli, setCopiedCli] = useState(false);
  const cliCommand =
    taskId && projectId
      ? `npx @networkbase/cli init --workspace=${projectId} --task=${taskId}`
      : taskId
        ? `npx @networkbase/cli init --task=${taskId}`
        : projectId
          ? `npx @networkbase/cli init --workspace=${projectId}`
          : `npx @networkbase/cli init`;
  const pickerRef = useRef<HTMLDivElement>(null);
  const cliRef = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const connectedIdes = useMemo(() => {
    const seen = new Set<SupportedIde>();
    return (sessions.data?.sessions ?? []).flatMap((session) => {
      if (
        session.clientVersion === "pending" ||
        !(session.editorPlatform || session.editorName)
      )
        return [];
      const id = resolveIdeFromSession(session);
      const ide = SUPPORTED_IDES[id];
      if (!ide || seen.has(id)) return [];
      seen.add(id);
      return [{ ide, session }];
    });
  }, [sessions.data?.sessions]);
  const activeConnectedIde =
    connectedIdes.find(({ ide }) => ide.id === preferred)?.ide ??
    connectedIdes[0]?.ide;
  const hasConnected = Boolean(activeConnectedIde);

  const executeDispatch = (
    ideId: SupportedIde,
    action: "workspace" | "marketplace",
    project?: IdeWorkspace,
  ) => {
    setFallbackIde(SUPPORTED_IDES[ideId]);
    setPreferredIde(ideId);
    setPreferred(ideId);
    setFallbackOpen(false);
    if (action === "workspace" && !projectId && !project) {
      setPickerOpen(false);
      setProjectPickerIde(ideId);
      return;
    }
    const file = location?.type === "file" ? location.node : null;
    const uri =
      action === "marketplace"
        ? buildIdeMarketplaceUri(ideId)
        : buildIdeLaunchUri({
            ide: ideId,
            projectId: project?.id ?? projectId!,
            projectSlug: project?.slug ?? projectSlug,
            fileId: file?.id,
            filePath: file?.path,
            taskId: taskId || undefined,
          });
    // Preserve the click gesture for the browser's native protocol prompt.
    dispatchIdeProtocol(uri, () => {
      if (mounted.current) setFallbackOpen(true);
    });
    setPickerOpen(false);
    setProjectPickerIde(null);
  };
  const platformLabel =
    platform === "darwin" ? "Mac" : platform === "win32" ? "PC" : "computer";

  return (
    <>
      <Dropdown.Root
        modal
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (open) setConnectAnother(false);
        }}
      >
        <div
          data-testid="open-in-ide-tool"
          className={cn(
            "inline-flex h-[var(--ui-control-height)] shrink-0 items-stretch rounded-md border border-border bg-card text-foreground",
            className,
          )}
        >
          {activeConnectedIde && (
            <button
              type="button"
              className={cn(controlClass, "rounded-l-[5px]")}
              onClick={() =>
                executeDispatch(activeConnectedIde.id, "workspace")
              }
              aria-label={`Open in ${activeConnectedIde.name}`}
              title={`Open in ${activeConnectedIde.name} (Connected)`}
            >
              <Image
                src={activeConnectedIde.icon}
                alt=""
                width={16}
                height={16}
                unoptimized
                className="size-4 shrink-0 object-contain"
              />
              <span className="truncate">Open in {activeConnectedIde.name}</span>
              <span
                aria-label="Connected"
                className="ml-0.5 size-1.5 shrink-0 rounded-[50%] bg-[var(--status-success)]"
              />
            </button>
          )}
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={
                hasConnected ? "Choose desktop editor" : "Connect your code editor"
              }
              title={
                hasConnected
                  ? "Choose desktop editor"
                  : "Connect your desktop editor"
              }
              className={cn(
                controlClass,
                "data-[state=open]:bg-muted",
                hasConnected
                  ? "w-7 shrink-0 rounded-r-[5px] border-l border-border px-0 pointer-coarse:w-11"
                  : "rounded-[5px]",
              )}
            >
              {!hasConnected && (
                <>
                  <Laptop
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                  {/* Board view dropdown §6: "Code" below 1280px so the board's toolbar stays on one line. */}
                  <span className="xl:hidden">Code</span><span className="hidden xl:inline">Code editor</span>
                </>
              )}
              {readOnlyNote ? <span className="rounded-[3px] border border-border px-1 text-[10px] text-muted-foreground">Read only</span> : null}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground",
                  !hasConnected && "ml-0.5",
                )}
              />
            </button>
          </Dropdown.Trigger>
        </div>
        <Dropdown.Portal>
          {/* Drawers sit at 201 and the nested mobile IDE sheet at 221. */}
          <Dropdown.Content
            ref={pickerRef}
            role="dialog"
            aria-labelledby={undefined}
            onFocusCapture={(event) => {
              // Dropdown's focus scope enters through its content container.
              if (event.target === event.currentTarget) {
                pickerRef.current?.querySelector("input")?.focus();
              }
            }}
            align="end"
            sideOffset={7}
            collisionPadding={12}
            className="z-[240] w-[304px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-md outline-none"
            aria-label="Desktop editor picker"
          >
            {readOnlyNote ? <p role="note" className="border-b border-border px-3 py-2 text-[12px] text-muted-foreground">{readOnlyNote}</p> : null}
            <DesktopIdePicker
              connectedIdes={connectedIdes}
              preferredIde={activeConnectedIde?.id}
              connecting={!hasConnected || connectAnother}
              installedList={installedList}
              platformLabel={platformLabel}
              detectingEditors={detectingEditors}
              loadingConnections={sessions.isPending}
              connectionsError={sessions.isError}
              onRetry={() => {
                void sessions.refetch();
              }}
              onSelect={(ide, connected) =>
                executeDispatch(ide.id, connected ? "workspace" : "marketplace")
              }
              onConnectAnother={() => setConnectAnother(true)}
              onSetupHelp={() => {
                setFallbackIde(activeConnectedIde ?? SUPPORTED_IDES[preferred]);
                setPickerOpen(false);
                setFallbackOpen(true);
              }}
            />
            <div className="border-t border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Terminal className="size-3.5 text-foreground" />
                  Terminal / CLI Push
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Root cause (2026-11-09): a refused clipboard write was dropped, so Copy did nothing and said
                    // nothing. Fall back inside the picker (it traps focus), and on failure select the command to copy by hand.
                    void copyText(cliCommand, pickerRef.current).then(() => {
                      setCopiedCli(true);
                      setTimeout(() => setCopiedCli(false), 2000);
                    }, () => {
                      if (cliRef.current) window.getSelection()?.selectAllChildren(cliRef.current);
                      toast.error("Couldn’t copy. The command is selected: press ⌘C or Ctrl+C.");
                    });
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
                >
                  {copiedCli ? (
                    <>
                      <Check className="size-3 text-[var(--status-success)]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <code ref={cliRef} title={cliCommand} className="mt-1.5 block select-all truncate rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground">
                {cliCommand}
              </code>
            </div>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      <IdeWorkspacePicker
        open={projectPickerIde !== null}
        onOpenChange={(open) => {
          if (!open) setProjectPickerIde(null);
        }}
        editorName={
          projectPickerIde
            ? SUPPORTED_IDES[projectPickerIde].name
            : "your editor"
        }
        onSelect={(project) => {
          if (projectPickerIde)
            executeDispatch(projectPickerIde, "workspace", project);
        }}
      />

      {/* Fallback Setup Modal */}
      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent
          overlayClassName="z-[250]"
          className="z-[251] sm:max-w-[400px]"
        >
          <DialogHeader className="text-left">
            <Image
              src={fallbackIde.icon}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="mb-1 size-8 object-contain"
            />
            <DialogTitle>Connect {fallbackIde.name}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              If nothing opened, install NetworkBase for VS Code in{" "}
              {fallbackIde.name}, then try again.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-inside list-decimal space-y-2 text-[13px] leading-relaxed text-muted-foreground">
            <li>
              Find{" "}
              <strong className="font-medium text-foreground">
                NetworkBase Workspace
              </strong>{" "}
              in your editor’s extensions.
            </li>
            <li>Install the extension and sign in to NetworkBase.</li>
            <li>Open your workspace or task in your connected editor.</li>
          </ol>

          <DialogFooter className="flex-col gap-2 pt-2 sm:flex-col">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="text-xs gap-1.5"
            >
              <Link href="/settings?tab=integrations">
                <KeyRound className="size-3.5" />
                Extension settings
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => executeDispatch(fallbackIde.id, "marketplace")}
              className="gap-1.5 bg-primary text-xs text-primary-foreground transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"
            >
              <ExternalLink className="size-3.5" />
              Open marketplace in {fallbackIde.name}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => executeDispatch(fallbackIde.id, "workspace")}
            >
              Try opening {fallbackIde.name}
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
}: OpenInIdeButtonProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layered?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName={layered ? "z-[220]" : undefined}
        className={layered ? "z-[221] md:hidden" : "md:hidden"}
      >
        <DialogTitle className="nb-card-title">Connect your code editor</DialogTitle>
        <DialogDescription className="nb-compact text-muted-foreground">
          Open this work in your desktop editor.
        </DialogDescription>
        <OpenInIdeButton {...buttonProps} />
      </DialogContent>
    </Dialog>
  );
}
