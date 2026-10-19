"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterPanel } from "@/components/ui/filter-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkillPicker } from "@/components/skills/SkillPicker";
import {
  activeNetworkFilters,
  clearedNetworkFilters,
  normalizeNetworkQuery,
  type NetworkBrowseQuery,
  type NetworkTab,
} from "@/lib/network/browse-query";

export function NetworkFilters({
  tab,
  query,
  onApply,
}: {
  tab: NetworkTab;
  query: NetworkBrowseQuery;
  onApply: (patch: Partial<NetworkBrowseQuery>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [locationValue, setLocationValue] = useState(query.location);
  const [shownLocation, setShownLocation] = useState(query.location);
  // Keep raw typing (including spaces) while the URL stores normalized filters.
  // Clear all and history navigation still synchronize the field from the URL.
  if (shownLocation !== query.location) {
    setShownLocation(query.location);
    if (locationValue.trim() !== query.location)
      setLocationValue(query.location);
  }
  const defaultSort = normalizeNetworkQuery(tab, {}).sort;
  const count =
    activeNetworkFilters(query) + Number(query.sort !== defaultSort);
  return (
    <FilterPanel
      open={open}
      onOpenChange={setOpen}
      activeFilters={count}
      onClear={() => onApply({ ...clearedNetworkFilters(), sort: defaultSort })}
      trigger={
        <Button
          variant="outline"
          aria-haspopup="dialog"
          className="bg-card pointer-coarse:h-11"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
          {count ? (
            <span className="nb-tab-count">
              {count}
              <span className="sr-only"> active</span>
            </span>
          ) : null}
        </Button>
      }
    >
      {tab !== "suggested" ? (
        <div>
          <label
            htmlFor="network-filter-sort"
            className="nb-ui-label mb-2 block"
          >
            Sort by
          </label>
          <Select
            value={query.sort}
            onValueChange={(sort) =>
              onApply({ sort: sort as NetworkBrowseQuery["sort"] })
            }
          >
            <SelectTrigger
              id="network-filter-sort"
              aria-label={
                tab === "connections" ? "Sort connections" : "Sort invitations"
              }
              className="bg-card pointer-coarse:h-11"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">
                {tab === "connections" ? "Recently connected" : "Newest"}
              </SelectItem>
              {tab === "connections" ? (
                <SelectItem value="name">Name</SelectItem>
              ) : (
                <SelectItem value="oldest">Oldest</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {tab === "invitations" ? (
        <div className="space-y-6">
          <div>
            <label
              htmlFor="network-filter-direction"
              className="nb-ui-label mb-2 block"
            >
              Direction
            </label>
            <Select
              value={query.direction}
              onValueChange={(direction) =>
                onApply({
                  direction: direction as NetworkBrowseQuery["direction"],
                })
              }
            >
              <SelectTrigger
                id="network-filter-direction"
                aria-label="Invitation direction"
                className="bg-card pointer-coarse:h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Received and sent</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label
              htmlFor="network-filter-kind"
              className="nb-ui-label mb-2 block"
            >
              Request type
            </label>
            <Select
              value={query.kind}
              onValueChange={(kind) =>
                onApply({ kind: kind as NetworkBrowseQuery["kind"] })
              }
            >
              <SelectTrigger
                id="network-filter-kind"
                aria-label="Invitation type"
                className="bg-card pointer-coarse:h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All requests</SelectItem>
                <SelectItem value="connections">Connection requests</SelectItem>
                <SelectItem value="projects">
                  Project invitations and applications
                </SelectItem>
                <SelectItem value="decided">Decided applications</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <SkillPicker
            compact
            dense
            progressive
            value={query.skills}
            maxSkills={5}
            onChange={(skills) => onApply({ skills })}
            label="Skills"
            description="Match all selected skills. Up to five."
          />
          <div>
            <label
              htmlFor="network-filter-location"
              className="nb-ui-label mb-2 block"
            >
              Location
            </label>
            <Input
              id="network-filter-location"
              className="pointer-coarse:h-11"
              maxLength={100}
              value={locationValue}
              placeholder="City, region, or country"
              onChange={(event) => {
                setLocationValue(event.target.value);
                onApply({ location: event.target.value });
              }}
            />
          </div>
          <label className="nb-compact flex min-h-11 items-center gap-3">
            <Checkbox
              checked={query.hasMutuals}
              onCheckedChange={(checked) =>
                onApply({ hasMutuals: checked === true })
              }
            />
            Has shared connections
          </label>
          {tab === "suggested" ? (
            <label className="nb-compact flex min-h-11 items-center gap-3">
              <Checkbox
                checked={query.openToCollaborate}
                onCheckedChange={(checked) =>
                  onApply({ openToCollaborate: checked === true })
                }
              />
              Open to collaborate
            </label>
          ) : null}
        </div>
      )}
    </FilterPanel>
  );
}

export function NetworkFilterChips({
  query,
  onChange,
}: {
  query: NetworkBrowseQuery;
  onChange: (patch: Partial<NetworkBrowseQuery>) => void;
}) {
  const chips: Array<{ label: string; clear: Partial<NetworkBrowseQuery> }> =
    query.skills.map((skill) => ({
      label: `Skill: ${skill}`,
      clear: { skills: query.skills.filter((value) => value !== skill) },
    }));
  if (query.location)
    chips.push({
      label: `Location: ${query.location}`,
      clear: { location: "" },
    });
  if (query.hasMutuals)
    chips.push({ label: "Shared connections", clear: { hasMutuals: false } });
  if (query.openToCollaborate)
    chips.push({
      label: "Open to collaborate",
      clear: { openToCollaborate: false },
    });
  if (query.direction !== "all")
    chips.push({
      label: query.direction === "received" ? "Received" : "Sent",
      clear: { direction: "all" },
    });
  if (query.kind !== "all")
    chips.push({
      label:
        query.kind === "connections"
          ? "Connection requests"
          : query.kind === "decided"
            ? "Decided applications"
            : "Project requests",
      clear: { kind: "all" },
    });
  if (!chips.length) return null;
  return (
    <div
      role="group"
      aria-label="Selected network filters"
      className="mt-4 flex flex-wrap items-center gap-1.5"
    >
      {chips.map((chip) => (
        <span key={chip.label} className="nb-tag gap-1 pr-0.5">
          {chip.label}
          <button
            className="nb-touch-target inline-flex size-6 items-center justify-center rounded-sm"
            aria-label={`Remove ${chip.label}`}
            onClick={(event) => {
              const group = event.currentTarget.closest("[role=group]"),
                buttons = group
                  ? [...group.querySelectorAll<HTMLButtonElement>("button")]
                  : [],
                index = buttons.indexOf(event.currentTarget);
              onChange(chip.clear);
              requestAnimationFrame(() => {
                const next =
                  group?.querySelectorAll<HTMLButtonElement>("button");
                (
                  next?.[Math.min(index, (next?.length ?? 1) - 1)] ??
                  document.querySelector<HTMLButtonElement>(
                    ".nb-network-toolbar button[aria-haspopup=dialog]",
                  )
                )?.focus();
              });
            }}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        className="nb-touch-target nb-compact px-2 text-primary hover:underline"
        onClick={() => {
          onChange(clearedNetworkFilters());
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLButtonElement>(
                ".nb-network-toolbar button[aria-haspopup=dialog]",
              )
              ?.focus(),
          );
        }}
      >
        Clear all
      </button>
    </div>
  );
}
