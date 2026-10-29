import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PAGE_PERFORMANCE_CONTRACTS,
  resolveRouteContract,
} from "@/lib/performance/page-contract";

describe("page performance contract", () => {
  it("has one contract per page route", () => {
    const pageFiles = (fs.readdirSync(path.join(process.cwd(), "src/app"), { recursive: true }) as string[])
      .filter((file) => path.basename(file) === "page.tsx")
      .map((file) => path.posix.join("src/app", file.split(path.sep).join("/")))
      .sort();
    const contractFiles = Object.values(PAGE_PERFORMANCE_CONTRACTS).map((contract) => contract.pageFile).sort();
    assert.deepEqual(contractFiles, pageFiles);
  });

  it("resolves dynamic route contracts from concrete URLs", () => {
    const projectRoute = resolveRouteContract("/workspaces/network-for-builders");
    assert.equal(projectRoute?.routeId, "/workspaces/[slug]");

    const userRoute = resolveRouteContract("/u/ch_rama1");
    assert.equal(userRoute?.routeId, "/u/[username]");
  });



  it("tracks explicit bootstrap and overload contracts for hot routes", () => {
    assert.deepEqual(
      {
        routeClass: PAGE_PERFORMANCE_CONTRACTS["/my-work"]?.routeClass,
        bootstrapReadModel: PAGE_PERFORMANCE_CONTRACTS["/my-work"]?.bootstrapReadModel,
        maxBackgroundChannels: PAGE_PERFORMANCE_CONTRACTS["/my-work"]?.maxBackgroundChannels,
        overloadMode: PAGE_PERFORMANCE_CONTRACTS["/my-work"]?.overloadMode,
      },
      {
        routeClass: "active_surface",
        bootstrapReadModel: "profile_counters",
        maxBackgroundChannels: 2,
        overloadMode: "fail_closed",
      },
    );

    assert.deepEqual(
      {
        routeClass: PAGE_PERFORMANCE_CONTRACTS["/"]?.routeClass,
        bootstrapReadModel: PAGE_PERFORMANCE_CONTRACTS["/"]?.bootstrapReadModel,
        maxBackgroundChannels: PAGE_PERFORMANCE_CONTRACTS["/"]?.maxBackgroundChannels,
        overloadMode: PAGE_PERFORMANCE_CONTRACTS["/"]?.overloadMode,
      },
      {
        routeClass: "public_cached",
        bootstrapReadModel: "static",
        maxBackgroundChannels: 0,
        overloadMode: "serve_stale_or_shed",
      },
    );
  });
});
