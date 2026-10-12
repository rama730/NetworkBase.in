import { ImageResponse } from "next/og";

import { readProjectDetailMetadata } from "@/app/actions/project";

function trimCopy(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  let title = trimCopy(slug.replace(/[-_]+/g, " "), "Project");
  let description = "Build with NetworkBase.";
  let isPublic = false;

  try {
    const result = await readProjectDetailMetadata({ slugOrId: slug });
    if (result.success) {
      isPublic = true;
      title = trimCopy(result.data.title, "Project");
      description = trimCopy(result.data.shortDescription || result.data.description, "Build with NetworkBase.");
    }
  } catch (error) {
    console.error("[project og route] failed to read project metadata", error);
  }

  const cacheControlHeader = isPublic
    // An hour: a project made private must not keep its social card for a month (SEC-009).
    ? "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600"
    : "private, no-store, no-cache, must-revalidate";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px",
          background:
            "#FAF8F4",
          color: "#141A1E",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 0,
              background: "#D14E24",
            }}
          />
          NetworkBase
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}>
          <div
            style={{
              fontSize: 60,
              lineHeight: 1.02,
              fontWeight: 600,
              letterSpacing: "-0.04em",
            }}
          >
            {title}
          </div>
          <div
            style={{
              maxWidth: 880,
              fontSize: 30,
              lineHeight: 1.3,
              color: "#374349",
            }}
          >
            {description}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "#4C5A61",
          }}
        >
          <div>Professional social network for builders</div>
          <div>NetworkBase</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": cacheControlHeader,
      },
    },
  );
}
