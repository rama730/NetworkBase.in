import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeNetworkFilters,
  clearedNetworkFilters,
  networkTab,
  normalizeNetworkQuery,
  readNetworkQuery,
  switchNetworkTab,
  writeNetworkQuery,
} from "../../src/lib/network/browse-query";

test("Network normalizes only filters and sort supported by each section", () => {
  const suggested = normalizeNetworkQuery("suggested", {
    q: "  Mira   Vale ",
    skills: ["React", "React.js", "TypeScript"],
    sort: "oldest",
    openToCollaborate: true,
    direction: "sent",
  });
  assert.equal(suggested.q, "Mira Vale");
  assert.deepEqual(suggested.skills, ["React", "TypeScript"]);
  assert.equal(suggested.sort, "recommended");
  assert.equal(suggested.direction, "all");
  assert.equal(activeNetworkFilters(suggested), 3);
  const invitations = normalizeNetworkQuery("invitations", {
    ...suggested,
    sort: "oldest",
    direction: "sent",
    kind: "projects",
    location: "Lisbon",
    hasMutuals: true,
  });
  assert.deepEqual(invitations.skills, []);
  assert.equal(invitations.location, "");
  assert.equal(invitations.openToCollaborate, false);
  assert.equal(invitations.hasMutuals, false);
  assert.equal(invitations.sort, "oldest");
  assert.equal(activeNetworkFilters(invitations), 2);
  assert.equal(
    normalizeNetworkQuery("connections", {
      openToCollaborate: true,
      sort: "name",
    }).openToCollaborate,
    false,
  );
  assert.equal(networkTab("network"), "connections");
  assert.equal(networkTab("requests"), "invitations");
});

test("Network URL state survives switches, refresh and history without leaking filters", () => {
  const params = new URLSearchParams("tab=suggested&q=Mira&unrelated=keep");
  writeNetworkQuery(params, "suggested", {
    skills: ["C++", "React"],
    location: "Lisbon & Porto",
    openToCollaborate: true,
  });
  const suggestedURL = params.toString();
  switchNetworkTab(params, "connections");
  assert.equal(readNetworkQuery(params, "connections").q, "");
  assert.deepEqual(readNetworkQuery(params, "connections").skills, []);
  writeNetworkQuery(params, "connections", {
    q: "Ada",
    sort: "name",
    hasMutuals: true,
  });
  switchNetworkTab(params, "invitations");
  writeNetworkQuery(params, "invitations", {
    direction: "received",
    kind: "projects",
    sort: "oldest",
  });
  switchNetworkTab(params, "suggested");
  assert.equal(params.get("q"), "Mira");
  assert.deepEqual(
    readNetworkQuery(new URLSearchParams(params.toString()), "suggested"),
    readNetworkQuery(new URLSearchParams(suggestedURL), "suggested"),
  );
  switchNetworkTab(params, "connections");
  assert.equal(readNetworkQuery(params, "connections").q, "Ada");
  assert.equal(readNetworkQuery(params, "connections").sort, "name");
  assert.equal(
    readNetworkQuery(params, "connections").openToCollaborate,
    false,
  );
  assert.equal(params.get("unrelated"), "keep");
  assert.equal(
    readNetworkQuery(new URLSearchParams(suggestedURL), "suggested").location,
    "Lisbon & Porto",
  );
});

test("Clear filters preserves search and sorting; reset explicitly clears search", () => {
  const params = new URLSearchParams(
    "tab=connections&q=Ada&connections.sort=name&connections.shared=1",
  );
  writeNetworkQuery(params, "connections", clearedNetworkFilters());
  assert.equal(readNetworkQuery(params, "connections").q, "Ada");
  assert.equal(readNetworkQuery(params, "connections").sort, "name");
  assert.equal(
    activeNetworkFilters(readNetworkQuery(params, "connections")),
    0,
  );
  writeNetworkQuery(params, "connections", { q: "" });
  assert.equal(params.has("q"), false);
  assert.equal(params.has("connections.q"), false);
});
