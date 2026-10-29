"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { Check, ExternalLink, Plus, Search } from "lucide-react";
import {
  SUPPORTED_IDES,
  type IdeDefinition,
  type SupportedIde,
} from "@/lib/extension/ide-protocol";
import type { ExtensionSessionData } from "@/types/settingsTypes";

interface DesktopIdePickerProps {
  connectedIdes: Array<{ ide: IdeDefinition; session: ExtensionSessionData }>;
  preferredIde?: SupportedIde;
  connecting: boolean;
  installedList: IdeDefinition[];
  platformLabel: string;
  detectingEditors: boolean;
  loadingConnections: boolean;
  connectionsError: boolean;
  onRetry: () => void;
  onSelect: (ide: IdeDefinition, connected: boolean) => void;
  onConnectAnother: () => void;
  onSetupHelp: () => void;
}

export function DesktopIdePicker({
  connectedIdes,
  preferredIde,
  connecting,
  installedList,
  platformLabel,
  detectingEditors,
  loadingConnections,
  connectionsError,
  onRetry,
  onSelect,
  onConnectAnother,
  onSetupHelp,
}: DesktopIdePickerProps) {
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const matches = (ide: IdeDefinition) =>
    `${ide.name} ${ide.description}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  const installed = new Set(installedList.map((ide) => ide.id));
  const groups = connecting
    ? [
        {
          label: `Installed on your ${platformLabel}`,
          items: installedList.filter(matches),
          connected: false,
        },
        {
          label: installed.size
            ? "Other supported editors"
            : "Supported editors",
          items: Object.values(SUPPORTED_IDES).filter(
            (ide) => !installed.has(ide.id) && matches(ide),
          ),
          connected: false,
        },
      ]
    : [
        {
          label: "Connected editors",
          items: connectedIdes.map(({ ide }) => ide).filter(matches),
          connected: true,
        },
      ];
  const hasResults = groups.some((group) => group.items.length);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // This searchable dialog owns text input and list navigation; menu typeahead
    // must not steal keystrokes or block Tab in the search field.
    event.stopPropagation();
    if (event.key === "Tab") {
      const controls = Array.from(root.current?.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])") ?? []);
      const boundary = event.shiftKey ? controls[0] : controls.at(-1);
      if (document.activeElement === boundary) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (
      event.target === searchRef.current &&
      ["Home", "End"].includes(event.key)
    )
      return;
    const buttons = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>(
        "[data-editor-option]",
      ) ?? [],
    );
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : current === -1
            ? event.key === "ArrowDown"
              ? 0
              : buttons.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) %
              buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div ref={root} onKeyDown={onKeyDown}>
      <div className="px-4 pb-3 pt-4">
        <h3 className="text-sm font-semibold">
          {connecting
            ? connectedIdes.length
              ? "Connect another editor"
              : "Connect your desktop IDE"
            : "Your desktop IDEs"}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {connecting
            ? "Choose an editor to connect to NetworkBase."
            : "Open your work or connect another editor."}
        </p>
      </div>
      <label className="mx-3 mb-2.5 flex h-8 items-center gap-2 rounded-[5px] border border-border px-2 text-muted-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <input
          ref={searchRef}
          autoFocus
          type="search"
          aria-label="Search editors"
          placeholder="Search editors…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {connectionsError && (
        <div className="mx-3 mb-2 text-xs text-muted-foreground" role="status">
          Couldn’t load editor connections.{" "}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      )}
      {loadingConnections ? (
        <div
          className="space-y-2 px-4 py-3"
          role="status"
          aria-label="Loading editor connections"
        >
          {[1, 2, 3].map((row) => (
            <div key={row} className="nb-skeleton h-10 rounded-[5px]" />
          ))}
        </div>
      ) : (
        <div className="max-h-[min(280px,40dvh)] overflow-y-auto overscroll-contain px-1 pb-1.5">
          {detectingEditors && connecting && (
            <p
              className="px-3 py-1 text-[11px] text-muted-foreground"
              role="status"
            >
              Checking available editors…
            </p>
          )}
          {groups
            .filter((group) => group.items.length)
            .map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h4 className="px-3 pb-1.5 pt-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {group.label}
                </h4>
                {group.items.map((ide) => (
                  <button
                    key={ide.id}
                    data-editor-option
                    type="button"
                    onClick={() => onSelect(ide, group.connected)}
                    className="flex min-h-[52px] w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Image
                      src={ide.icon}
                      alt=""
                      width={22}
                      height={22}
                      unoptimized
                      className="size-[22px] shrink-0 object-contain"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {ide.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {group.connected
                          ? "Connected to NetworkBase"
                          : ide.description}
                      </span>
                    </span>
                    {group.connected ? (
                      ide.id === preferredIde && (
                        <Check
                          className="size-3.5 shrink-0 text-primary"
                          aria-label="Preferred editor"
                        />
                      )
                    ) : installed.has(ide.id) ? (
                      <span className="text-[10px] text-[var(--status-success)]">
                        Installed
                      </span>
                    ) : (
                      <ExternalLink
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </section>
            ))}
          {!hasResults && (
            <p
              className="px-3 py-5 text-xs text-muted-foreground"
              role="status"
            >
              No matching editors. Try another name.
            </p>
          )}
          {!connecting && (
            <button
              data-editor-option
              type="button"
              onClick={() => {
                setSearch("");
                onConnectAnother();
                searchRef.current?.focus();
              }}
              className="mt-1 flex min-h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-xs text-primary outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Plus className="size-3.5" />
              Connect another editor
            </button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-background px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span>NetworkBase for VS Code</span>
        <button
          type="button"
          onClick={onSetupHelp}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Setup help
          <ExternalLink className="size-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
