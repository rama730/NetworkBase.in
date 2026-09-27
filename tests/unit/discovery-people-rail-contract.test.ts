import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Discovery people rail is a compact, shared-avatar recommendation surface", () => {
  const rail = source("src/components/hub/DiscoverPeopleRail.tsx");
  const hub = source("src/components/hub/SimpleHubClient.tsx");
  const networkCard = source("src/components/people/PersonCard.tsx");
  const css = source("src/app/globals.css");

  assert.match(rail, /useSuggestedPeople\(3/);
  assert.match(rail, /<UserAvatar\b/);
  assert.match(rail, /People you should meet/);
  assert.match(rail, /getConnectionRequestSuccessMessage/);
  assert.doesNotMatch(rail, /Suggested for your network/);
  assert.match(rail, /nb-discover-person-avatar/);
  assert.match(rail, /PersonPresenceDot/);
  assert.match(rail, /nb-person-connect--compact/);
  assert.match(networkCard, /nb-person-connect/);
  assert.match(networkCard, /PersonPresenceDot/);
  assert.match(hub, /<DiscoverPeopleRail initialPage=\{initialPeopleSuggestions\} variant="desktop"/);
  assert.match(css, /\.nb-discover-person-card/);
  assert.match(css, /\.nb-person-presence-dot/);
  assert.match(css, /\.nb-person-connect/);
  assert.doesNotMatch(hub, /variant="compact"/);
});

test("rail recommendations use the same privacy-safe source as the connection list", () => {
  const connections = source("src/app/actions/connections.ts");
  const suggestions = source("src/inngest/functions/social-graph-suggestions.ts");
  const profile = source("src/app/actions/profile.ts");
  const hubPage = source("src/app/(main)/hub/page.tsx");

  assert.match(hubPage, /getConnectionsFeed\(\{ tab: 'discover', limit: 3, includeMeta: false \}\)/);
  assert.doesNotMatch(connections, /recommendationMode/);
  assert.match(connections, /applySuggestedProfilePrivacy\(user\.id, items, privacyProfiles\)/);
  assert.match(connections, /NOT EXISTS \(\s*SELECT 1 FROM \$\{connections\} existing/);
  assert.match(suggestions, /notInArray\(connectionSuggestions\.suggestedUserId/);
  assert.match(suggestions, /db\.delete\(connectionSuggestions\)/);
  assert.match(suggestions, /refreshSocialGraphSuggestionsForCandidate/);
  assert.match(profile, /workspace\/connections\.refresh_suggestions_for_candidate/);
});
