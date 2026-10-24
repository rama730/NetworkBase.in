import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import {
  ContributionMarkdown,
  ContributionIdentityLinks,
  ContributionImageDescription,
  ContributionStoryView,
} from "@/components/profile/ContributionStoryView";
import {
  blankContributionStory,
  referenceToken,
} from "@/lib/profile/contribution-story";

test("contribution markdown escapes HTML, omits embedded image URLs and uses authoritative reference labels", () => {
  const id = randomUUID();
  const summary = `<script>alert(1)</script>\n\n![private](https://example.com/private.png)\n\n${referenceToken("person", id)}\n\n[bad](javascript:alert(1))`;
  const html = renderToStaticMarkup(
    <ContributionMarkdown
      summary={summary}
      references={[
        {
          kind: "person",
          id,
          label: "Public teammate",
          href: "/u/public",
          available: true,
        },
      ]}
    />,
  );
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /Public teammate/);
  assert.match(html, /href="\/u\/public"/);
  const hidden = renderToStaticMarkup(
    <ContributionMarkdown
      summary={referenceToken("person", id)}
      references={[
        {
          kind: "person",
          id,
          label: "Unavailable person",
          href: null,
          available: false,
        },
      ]}
    />,
  );
  assert.match(hidden, /Unavailable person/);
  assert.doesNotMatch(hidden, /href=/);
});
test("visitor SSR keeps the complete story readable before measurement with identity links at its heading", () => {
  const id = randomUUID(),
    roleId = randomUUID(),
    assetId = randomUUID();
  const story = {
    ...blankContributionStory("Work"),
    summary: "I built a reliable workspace and documented how it works.",
    start: "2026-03",
    positions: [
      {
        id: roleId,
        recordedStageId: null,
        title: "Engineer",
        start: "2026-03",
        end: "",
        current: false,
        description: "Work done",
        hidden: false,
      },
    ],
    images: [
      {
        id: randomUUID(),
        assetId,
        caption: "Workspace",
        alt: "Workspace navigation",
        positionId: roleId,
        projectFileId: null,
        permission: true,
      },
    ],
    links: [
      { id: randomUUID(), label: "Website", url: "https://example.com" },
      {
        id: randomUUID(),
        label: "Repository",
        url: "https://github.com/example/app",
      },
    ],
  };
  const contribution = {
    id,
    projectId: randomUUID(),
    title: "Engineer",
    projectTitle: "Work",
    projectHref: "/projects/work",
    repoUrl: null,
    description: null,
    startDate: null,
    endDate: null,
    currentlyActive: false,
    skills: [],
    source: "membership",
    verified: true,
    presentation: story,
  };
  const html = renderToStaticMarkup(
    <ContributionStoryView contribution={contribution} />,
  );
  assert.doesNotMatch(
    html,
    /Read contribution|inert=""|max-height:|data-clipped/,
  );
  assert.match(html, /Mar 2026/);
  assert.doesNotMatch(html, /End date not|Present|ACTIVITY EVIDENCE/);
  assert.ok(
    html.indexOf("https://github.com/example/app") <
      html.indexOf("nb-story-reveal"),
  );
  const header = html.match(/<header[^>]*>([\s\S]*?)<\/header>/)![1]!;
  const identity = header.slice(0, header.indexOf('class="nb-story-metadata'));
  const details = header.slice(header.indexOf('class="nb-story-metadata'));
  assert.match(identity, /<h3[^>]*>[\s\S]*?Work[\s\S]*?<\/h3>/);
  assert.match(identity, /nb-story-headline-role[^>]*>Engineer/);
  assert.doesNotMatch(identity, /Mar 2026|https:\/\//);
  assert.match(details, /Mar 2026/);
  assert.doesNotMatch(details, /Linked project|Self-reported/);
  assert.match(details, /https:\/\/example.com/);
  assert.match(details, /https:\/\/github.com\/example\/app/);
  assert.match(
    html,
    /nb-story-heading[^>]*grid-cols-\[minmax\(0,1fr\)_auto\][^>]*items-center/,
  );
  assert.match(identity, /nb-story-identity[^>]*flex-nowrap/);
  assert.match(details, /nb-story-date[^>]*whitespace-nowrap[^>]*text-right/);
  assert.match(
    details,
    /nb-story-metadata[^>]*flex[^>]*items-center[^>]*justify-end/,
  );
  assert.ok(
    details.indexOf("https://github.com/example/app") <
      details.indexOf("Mar 2026"),
  );
  assert.doesNotMatch(header, /nb-story-project-context|col-span-2/);
  assert.doesNotMatch(html, /Position history|<h5/);
  assert.equal((html.match(/>Engineer</g) ?? []).length, 1);
  assert.match(html, /Work done/);
  assert.match(html, /Workspace navigation/);
  const expanded = renderToStaticMarkup(
    <ContributionStoryView contribution={contribution} expandedByDefault />,
  );
  assert.doesNotMatch(expanded, /max-height:|data-clipped/);
  assert.doesNotMatch(expanded, /inert=""/);
  const caption = expanded.match(
    /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/,
  )![1]!;
  assert.match(caption, /Workspace navigation/);
  assert.match(caption, /Workspace<\/p>/);
  const stale = renderToStaticMarkup(
    <ContributionStoryView
      contribution={{
        ...contribution,
        presentation: {
          ...story,
          positions: story.positions.map((p) => ({ ...p, current: true })),
        },
      }}
      expandedByDefault
    />,
  );
  assert.doesNotMatch(stale, /Present|End date not/);
  const ongoing = renderToStaticMarkup(
    <ContributionStoryView
      contribution={{
        ...contribution,
        presentation: {
          ...story,
          current: true,
          positions: story.positions.map((p) => ({ ...p, current: true })),
        },
      }}
      expandedByDefault
    />,
  );
  assert.equal((ongoing.match(/Present/g) ?? []).length, 1);
  const previous = {
    ...story.positions[0]!,
    id: randomUUID(),
    title: "Tester",
    start: "2025-01",
    end: "2025-12",
  };
  const history = renderToStaticMarkup(
    <ContributionStoryView
      contribution={{
        ...contribution,
        presentation: { ...story, positions: [...story.positions, previous] },
      }}
      expandedByDefault
    />,
  );
  assert.match(history, /<h4[^>]*font-semibold[^>]*>Position history<\/h4>/);
  assert.match(history, /<h5[^>]*font-semibold[^>]*>Tester<\/h5>/);
  const hidden = renderToStaticMarkup(
    <ContributionStoryView
      contribution={{
        ...contribution,
        presentation: {
          ...story,
          positions: [...story.positions, { ...previous, hidden: true }],
        },
      }}
      expandedByDefault
    />,
  );
  assert.doesNotMatch(hidden, /Position history|<h5/);
  const minimal = renderToStaticMarkup(
    <ContributionStoryView
      contribution={{
        ...contribution,
        presentation: {
          ...story,
          summary: "",
          positions: [{ ...story.positions[0]!, description: "" }],
          images: [],
          skills: [],
          links: [],
        },
      }}
    />,
  );
  assert.doesNotMatch(
    minimal,
    /Position history|Read contribution|nb-story-project-context/,
  );
});
test("image descriptions are visible text as well as alt text, independently of an optional caption", () => {
  const image = {
    id: randomUUID(),
    assetId: randomUUID(),
    caption: "",
    alt: "A diagram of the review workflow.",
    positionId: null,
    projectFileId: null,
    permission: true,
  };
  const html = renderToStaticMarkup(
    <ContributionImageDescription image={image} />,
  );
  assert.match(html, /<p[^>]*>A diagram of the review workflow\.<\/p>/);
  const duplicate = renderToStaticMarkup(
    <ContributionImageDescription image={{ ...image, caption: image.alt }} />,
  );
  assert.equal(
    (duplicate.match(/A diagram of the review workflow\./g) ?? []).length,
    1,
  );
});
test("contribution links use only accessible GitHub or globe icons, deduplicate URLs and reject unsafe links", () => {
  const links = [
    {
      id: randomUUID(),
      label: "Repository",
      url: "https://github.com/example/app",
    },
    { id: randomUUID(), label: "Case study", url: "https://example.com/story" },
    {
      id: randomUUID(),
      label: "Repository",
      url: "https://gitlab.com/example/app",
    },
    {
      id: randomUUID(),
      label: "GitHub lookalike",
      url: "https://github.com.example.com/app",
    },
    {
      id: randomUUID(),
      label: "Duplicate",
      url: "https://github.com/example/app",
    },
    { id: randomUUID(), label: "Unsafe", url: "javascript:alert(1)" },
  ];
  const html = renderToStaticMarkup(
    <ContributionIdentityLinks links={links} />,
  );
  assert.equal((html.match(/<a /g) ?? []).length, 4);
  assert.equal((html.match(/lucide-github/g) ?? []).length, 1);
  assert.equal((html.match(/lucide-globe/g) ?? []).length, 3);
  assert.match(html, /aria-label="Open GitHub repository:/);
  assert.match(html, /aria-label="Open Case study:/);
  assert.doesNotMatch(html, /javascript:|lucide-code|↗/);
  for (const anchor of html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)) {
    assert.match(anchor[1]!, /^<svg /);
    assert.equal(anchor[1]!.replace(/<svg[\s\S]*?<\/svg>/g, ""), "");
  }
});

test("contribution story renders demonstrated skills using SkillChip with skill icons", () => {
  const story = {
    ...blankContributionStory("React App"),
    summary: "Built the front-end with React and TypeScript.",
    skills: ["React", "TypeScript", "NonExistentCustomSkill"],
  };
  const contribution = {
    id: randomUUID(),
    projectId: randomUUID(),
    title: "Engineer",
    projectTitle: "React App",
    projectHref: "/projects/react-app",
    repoUrl: null,
    description: null,
    startDate: null,
    endDate: null,
    currentlyActive: false,
    skills: ["React", "TypeScript"],
    source: "membership" as const,
    verified: true,
    presentation: story,
  };
  const html = renderToStaticMarkup(
    <ContributionStoryView contribution={contribution} expandedByDefault />,
  );
  assert.match(html, /data-skill-key=/);
  assert.match(html, /React/);
  assert.match(html, /TypeScript/);
  assert.match(html, /NonExistentCustomSkill/);
});
