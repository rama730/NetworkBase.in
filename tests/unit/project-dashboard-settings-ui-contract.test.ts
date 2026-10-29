import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getJourneyCenteredScrollLeft, getJourneyStageWindow, getStageCompletionTooltip, JOURNEY_VISIBLE_STAGE_COUNT } from "../../src/components/projects/dashboard/JourneyTimeline";
import { projectActionsSource } from "./_project-actions-source";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project dashboard keeps journey connectors, statements, and skills stable", () => {
  const journey = source("src/components/projects/dashboard/JourneyTimeline.tsx");
  const overview = source("src/components/projects/dashboard/ProjectOverviewCard.tsx");

  assert.match(journey, /left-0 right-1\/2/);
  assert.match(journey, /left-1\/2 right-0/);
  assert.match(journey, /scrollContainerRef/);
  assert.match(journey, /app-scroll-x app-scroll-hidden/);
  assert.match(journey, /data-stage-index="\$\{safeCurrentStageIndex\}"/);
  assert.match(journey, /getJourneyCenteredScrollLeft/);
  assert.match(journey, /new ResizeObserver\(\(\) => \{\s*window\.requestAnimationFrame\(alignCurrentStage\)/);
  assert.match(journey, /stages\.map/);
  assert.match(journey, /index === safeCurrentStageIndex/);
  assert.match(journey, /index < safeCurrentStageIndex/);
  assert.doesNotMatch(journey, /progress \/ 100/);
  assert.doesNotMatch(journey, /projectUpdatedAt/);
  assert.doesNotMatch(journey, /Completed before/);

  assert.match(overview, /min-h-44/);
  assert.match(overview, /line-clamp-6/);
  assert.match(overview, /Click to read full text/);
  assert.match(overview, /<Dialog open=\{Boolean\(statement\)\}/);
  assert.match(overview, /normalizeProjectSkills/);
  assert.match(overview, /project\?\.skills/);
  assert.match(overview, /project\?\.technologies_used/);
  assert.match(overview, /project\?\.techStack/);
  assert.match(overview, /Skills and tech/);
});

test("project detail keeps identity and team in the header while the dashboard starts with project substance", () => {
  const layout = source("src/components/projects/dashboard/ProjectLayout.tsx");
  const avatars = source("src/components/projects/dashboard/ProjectTeamAvatars.tsx");
  const client = source("src/components/projects/dashboard/ProjectDashboardClient.tsx");
  const links = source("src/components/projects/dashboard/ProjectSocialLinksCard.tsx");
  const stats = source("src/components/projects/ProjectStatsBar.tsx");
  const tooltip = source("src/components/ui/tooltip.tsx");
  const dashboard = source("src/components/projects/tabs/DashboardTab.tsx");
  const overview = source("src/components/projects/dashboard/ProjectOverviewCard.tsx");
  const railJourney = source("src/components/projects/dashboard/JourneyTimeline.tsx").split('if (layout === "rail")')[1]?.split("\n    return (")[0] ?? "";

  assert.doesNotMatch(layout, /ChevronLeft/);
  assert.doesNotMatch(layout, />\s*Discover\s*</);
  assert.match(layout, /<ProjectTeamAvatars/);
  assert.match(layout, /projectUpdatedLabel/);
  assert.match(layout, /onInvite/);
  assert.doesNotMatch(layout, /activeTabButton\?\.scrollIntoView/, "Project tab selection must not move the route vertically");
  assert.match(layout, /tabList\.scrollTo\(\{ left: Math\.max\(0, centeredLeft\), behavior: "smooth" \}\)/);
  assert.match(layout, /nb-page-title/);
  assert.match(layout, /nb-touch-target/);
  assert.match(client, /onInvite=\{\(\) => \(isOrganization \? setIsOrgInviteOpen\(true\) : setIsInviteModalOpen\(true\)\)\}/);
  assert.match(client, /canInvite=\{canManageProjectSettings\}/);
  assert.match(stats, /followersCount/);
  assert.match(stats, /font-mono tabular-nums/);
  assert.match(links, /h-\[var\(--ui-control-height\)\]/);
  assert.match(tooltip, /rounded-sm/);
  assert.match(tooltip, /px-\[7px\] py-1/);
  assert.doesNotMatch(tooltip, /TooltipPrimitive\.Arrow/);
  assert.doesNotMatch(tooltip, /zoom-in-95/);

  assert.match(avatars, /TooltipContent/);
  assert.match(avatars, /avatar\.name/);
  assert.match(avatars, /avatar\.role/);
  assert.match(avatars, /profileHref/);
  assert.match(avatars, /size-\[34px\]/);
  assert.doesNotMatch(avatars, /hover:-translate-y/);

  assert.doesNotMatch(dashboard, /TeamCard/);
  assert.match(dashboard, /layout="rail"/);
  assert.match(dashboard, /lg:grid-cols-12/);
  assert.match(dashboard, /lg:col-span-8[\s\S]*lg:col-span-4/);
  assert.match(railJourney, /app-scroll app-scroll-x app-scroll-hidden overflow-x-auto/);
  assert.match(railJourney, /gridTemplateColumns/);
  assert.match(railJourney, /left-0 right-1\/2/);
  assert.match(railJourney, /left-1\/2 right-0/);
  assert.doesNotMatch(railJourney, /<ol/);

  assert.doesNotMatch(overview, /JourneyTimeline/);
  assert.doesNotMatch(overview, /project\?\.title/);
  assert.doesNotMatch(overview, /project\?\.shortDescription/);
  assert.match(overview, /Vision and description/);
  assert.match(overview, /The problem/);
  assert.match(overview, /The solution/);
});

test("project journey windows around the current stage", () => {
  assert.equal(JOURNEY_VISIBLE_STAGE_COUNT, 5);
  assert.deepEqual(getJourneyStageWindow(7, 5), { start: 2, end: 7, currentStageIndex: 5 });
  assert.deepEqual(getJourneyStageWindow(7, 0), { start: 0, end: 5, currentStageIndex: 0 });
  assert.deepEqual(getJourneyStageWindow(7, 99), { start: 2, end: 7, currentStageIndex: 6 });
});

test("project journey centers the current pointer and clamps at both ends", () => {
  assert.equal(getJourneyCenteredScrollLeft({ itemOffsetLeft: 0, itemWidth: 112, containerWidth: 336, scrollWidth: 784 }), 0);
  assert.equal(getJourneyCenteredScrollLeft({ itemOffsetLeft: 448, itemWidth: 112, containerWidth: 336, scrollWidth: 784 }), 336);
  assert.equal(getJourneyCenteredScrollLeft({ itemOffsetLeft: 672, itemWidth: 112, containerWidth: 336, scrollWidth: 784 }), 448);
  assert.equal(getJourneyCenteredScrollLeft({ itemOffsetLeft: 0, itemWidth: 112, containerWidth: 560, scrollWidth: 560 }), 0);
});

test("completed journey stages always have an honest hover label", () => {
  assert.equal(
    getStageCompletionTooltip("2026-08-25T00:00:00.000Z"),
    "Finished on Aug 25, 2026",
  );
  assert.equal(
    getStageCompletionTooltip(undefined),
    "Finished — date not recorded",
  );
  assert.equal(getStageCompletionTooltip("not-a-date"), "Finished — date not recorded");
});

test("journey stage transitions record all crossed stages and lifecycle edits remap dates", () => {
  const actions = projectActionsSource();

  assert.match(actions, /currentStageIndex: projects\.currentStageIndex/);
  assert.match(actions, /stageCompletionDates: projects\.stageCompletionDates/);
  assert.match(actions, /stageCompletionDates: normalizeJourneyCompletionDates\(/);
  assert.match(actions, /buildJourneyCompletionDates/);
  assert.match(actions, /normalizeJourneyCompletionDates/);
  assert.match(actions, /completionDatesByStage/);
  assert.match(actions, /stageCompletionDates: remappedCompletionDates/);
  // Stage moves go through updateProjectStageAction only; the general update rejects the field.
  const updateSchema = source("src/lib/validations/project.ts").match(/export const updateProjectSchema[\s\S]*?\.strict\(\)/)?.[0] ?? "";
  assert.ok(updateSchema);
  assert.doesNotMatch(updateSchema, /currentStageIndex:/);
  assert.match(actions, /const updatedDates = buildJourneyCompletionDates\(/);
});

test("project links resolve and persist exact destination names", () => {
  const editor = source("src/components/projects/dashboard/ProjectSocialLinksCard.tsx");
  const previewRoute = source("src/app/api/v1/link-preview/route.ts");
  const normalization = source("src/lib/profile/normalization.ts");

  assert.match(editor, /useLinkPreview\(metadataUrl\)/);
  assert.match(editor, /destinationLabel: effectiveDestinationLabel/);
  assert.match(editor, /Identifying destination/);
  assert.match(previewRoute, /youtube\.com\/oembed/);
  assert.match(previewRoute, /normalizeLinkDestinationTitle/);
  assert.match(normalization, /accountLabel: item\.destinationLabel/);
});

test("integrations settings shows extension app identity before sessions", () => {
  const integrations = source("src/components/settings/IntegrationsSettings.tsx");

  assert.match(integrations, /function ExtensionAppCard/);
  assert.match(integrations, /\/icon-(?:paper-|ink-)?192\.png/);
  assert.match(integrations, /NetworkBase editor extension/);
  assert.match(integrations, /\/ide-icons\/vscode\.png/);
  assert.match(integrations, /\/ide-icons\/cursor\.png/);
  assert.match(integrations, /\/ide-icons\/windsurf\.svg/);
  assert.match(integrations, /\/ide-icons\/antigravity\.png/);
  assert.match(integrations, /Revoke any time/);
  assert.match(integrations, /Sign in from your editor/);
  assert.match(integrations, /session\.clientVersion/);
  assert.match(integrations, /session\.editorVersion/);
});
