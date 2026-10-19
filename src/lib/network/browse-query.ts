import { canonicalizeSkillLabels } from "@/lib/skills/matching";

export type NetworkTab = "suggested" | "invitations" | "connections";
export type NetworkPersonFilters = {
  skills?: string[];
  location?: string;
  hasMutuals?: boolean;
  openToCollaborate?: boolean;
};
export type NetworkBrowseQuery = {
  q: string;
  sort: "recommended" | "recent" | "oldest" | "name";
  skills: string[];
  location: string;
  hasMutuals: boolean;
  openToCollaborate: boolean;
  direction: "all" | "received" | "sent";
  kind: "all" | "connections" | "projects";
};
export const NETWORK_TABS: NetworkTab[] = [
  "suggested",
  "invitations",
  "connections",
];
export function networkTab(value?: string | null): NetworkTab {
  return value === "connections" || value === "network"
    ? "connections"
    : value === "invitations" || value === "requests"
      ? "invitations"
      : "suggested";
}
export function normalizeNetworkQuery(
  tab: NetworkTab,
  input: Partial<NetworkBrowseQuery>,
): NetworkBrowseQuery {
  return {
    q: (input.q ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 100),
    sort:
      tab === "suggested"
        ? "recommended"
        : tab === "invitations"
          ? input.sort === "oldest"
            ? "oldest"
            : "recent"
          : input.sort === "name"
            ? "name"
            : "recent",
    skills:
      tab === "invitations"
        ? []
        : canonicalizeSkillLabels(input.skills ?? [], 5),
    location:
      tab === "invitations" ? "" : (input.location ?? "").trim().slice(0, 100),
    hasMutuals: tab !== "invitations" && input.hasMutuals === true,
    openToCollaborate: tab === "suggested" && input.openToCollaborate === true,
    direction:
      tab === "invitations" &&
      (input.direction === "received" || input.direction === "sent")
        ? input.direction
        : "all",
    kind:
      tab === "invitations" &&
      (input.kind === "connections" || input.kind === "projects")
        ? input.kind
        : "all",
  };
}
export function readNetworkQuery(
  params: Pick<URLSearchParams, "get" | "getAll">,
  tab: NetworkTab,
): NetworkBrowseQuery {
  const prefix = tab + ".";
  return normalizeNetworkQuery(tab, {
    q:
      networkTab(params.get("tab")) === tab
        ? (params.get("q") ?? params.get(prefix + "q") ?? "")
        : (params.get(prefix + "q") ?? ""),
    sort: params.get(prefix + "sort") as NetworkBrowseQuery["sort"],
    skills: params.getAll(prefix + "skill"),
    location: params.get(prefix + "location") ?? "",
    hasMutuals: params.get(prefix + "shared") === "1",
    openToCollaborate: params.get(prefix + "open") === "1",
    direction: params.get(
      prefix + "direction",
    ) as NetworkBrowseQuery["direction"],
    kind: params.get(prefix + "kind") as NetworkBrowseQuery["kind"],
  });
}
export function writeNetworkQuery(
  params: URLSearchParams,
  tab: NetworkTab,
  patch: Partial<NetworkBrowseQuery>,
) {
  const next = normalizeNetworkQuery(tab, {
    ...readNetworkQuery(params, tab),
    ...patch,
  });
  const prefix = tab + ".";
  for (const key of [
    "q",
    "sort",
    "skill",
    "location",
    "shared",
    "open",
    "direction",
    "kind",
  ])
    params.delete(prefix + key);
  if (next.q) params.set(prefix + "q", next.q);
  if (next.sort !== (tab === "suggested" ? "recommended" : "recent"))
    params.set(prefix + "sort", next.sort);
  for (const skill of next.skills) params.append(prefix + "skill", skill);
  if (next.location) params.set(prefix + "location", next.location);
  if (next.hasMutuals) params.set(prefix + "shared", "1");
  if (next.openToCollaborate) params.set(prefix + "open", "1");
  if (next.direction !== "all")
    params.set(prefix + "direction", next.direction);
  if (next.kind !== "all") params.set(prefix + "kind", next.kind);
  if (networkTab(params.get("tab")) === tab) {
    if (next.q) params.set("q", next.q);
    else params.delete("q");
  }
  return params;
}
export function switchNetworkTab(params: URLSearchParams, next: NetworkTab) {
  const current = networkTab(params.get("tab"));
  writeNetworkQuery(params, current, {});
  params.set("tab", next);
  const search = params.get(next + ".q");
  if (search) params.set("q", search);
  else params.delete("q");
  return params;
}
export function networkPersonFilters(
  query: NetworkBrowseQuery,
): NetworkPersonFilters {
  return {
    skills: query.skills,
    location: query.location,
    hasMutuals: query.hasMutuals,
    openToCollaborate: query.openToCollaborate,
  };
}
export function activeNetworkFilters(query: NetworkBrowseQuery) {
  return (
    query.skills.length +
    Number(Boolean(query.location)) +
    Number(query.hasMutuals) +
    Number(query.openToCollaborate) +
    Number(query.direction !== "all") +
    Number(query.kind !== "all")
  );
}
export function clearedNetworkFilters(): Partial<NetworkBrowseQuery> {
  return {
    skills: [],
    location: "",
    hasMutuals: false,
    openToCollaborate: false,
    direction: "all",
    kind: "all",
  };
}
