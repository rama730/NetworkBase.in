import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Discovery people rail is a compact, shared-avatar recommendation surface", () => {
  const rail = source("src/components/discover/DiscoverPeopleRail.tsx");
  const hub = source("src/components/discover/DiscoverClient.tsx");
  const networkCard = source("src/components/network/PersonCard.tsx");
  const content = source("src/components/network/PersonCardContent.tsx");
  const css = source("src/app/globals.css");

  assert.match(rail, /useSuggestedPeople\(DISCOVER_RAIL_PEOPLE_LIMIT/);
  assert.match(rail, /People you should meet/);
  assert.match(rail, /getConnectionRequestSuccessMessage/);
  assert.doesNotMatch(rail, /Suggested for your network/);
  assert.match(rail, /PersonCard/);
  assert.match(rail, /\.unwrap\(\)/);
  assert.match(content, /<UserAvatar identity=\{person\} size=\{48\}/);
  assert.match(networkCard, /nb-person-connect/);
  assert.match(content, /PersonPresenceDot/);
  assert.match(networkCard, /PersonCardContent/);
  assert.match(rail, /variant="rail"/);
  assert.match(hub, /<DiscoverPeopleRail initialPage=\{initialPeopleSuggestions\} variant="desktop"/);
  assert.match(css, /\.nb-person-presence-dot/);
  assert.match(css, /\.nb-person-connect/);
  // Compact rail lives only in the mobile People drawer (DiscoverHeader `people` slot).
  // Below 1200px the People button exists only when there are people to show (never an empty drawer),
  // and the rail column only when it has content (people or the checklist).
  assert.match(hub, /const people = hasPeople && wide === false\s*\? <><DiscoverPeopleRail initialPage=\{initialPeopleSuggestions\} variant="compact" \/><div className="pt-4">\{legal\}<\/div><\/>/);
  assert.match(hub, /const showRail = wide !== false && \(hasPeople \|\| checklist\.length > 0\)/);
  assert.match(hub, /people=\{people\}/);
  assert.equal(hub.match(/variant="compact"/g)?.length, 1);
});

test("rail recommendations use the same privacy-safe source as the connection list", () => {
  const connections = source("src/app/actions/connections.ts");
  const suggestions = source("src/lib/connections/suggestions.ts");
  const inngest = source("src/inngest/functions/social-graph-suggestions.ts");
  const profile = source("src/app/actions/profile.ts");
  const hubPage = source("src/app/(site)/(main)/discover/page.tsx");

  assert.match(hubPage, /getConnectionsFeed\(\{ tab: 'discover', limit: DISCOVER_RAIL_PEOPLE_LIMIT, includeMeta: false, includeSharedConnections: true, filters: DISCOVER_RAIL_FILTERS \}\)/);
  // The rail shows only people you can see and connect with.
  assert.match(connections, /openProfilesOnly/);
  // The input schema is strict: a filter it doesn't list rejects every rail request.
  assert.match(connections, /filters: z\.object\(\{[^}]*openProfilesOnly: z\.boolean\(\)\.optional\(\)/);
  assert.doesNotMatch(connections, /recommendationMode/);
  assert.match(connections, /applySuggestedProfilePrivacy\(user\.id, items\)/);
  assert.match(connections, /NOT EXISTS \(\s*SELECT 1 FROM \$\{connections\} existing/);
  assert.match(suggestions, /notInArray\(connectionSuggestions\.suggestedUserId/);
  assert.match(suggestions, /(?:db|tx)\.delete\(connectionSuggestions\)/);
  assert.match(inngest, /refreshSocialGraphSuggestionsForCandidate/);
  assert.match(profile, /workspace\/connections\.refresh_suggestions_for_candidate/);
});
