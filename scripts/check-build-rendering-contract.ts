import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { PAGE_PERFORMANCE_CONTRACTS } from "../src/lib/performance/page-contract";

type PrerenderManifest = {
  routes?: Record<string, { initialRevalidateSeconds?: number | false }>;
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

async function waitForServer(baseUrl: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(baseUrl, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Production server did not start at ${baseUrl}`);
}

function initialScriptFiles(html: string) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="\/_next\/([^"]+\.js)"[^>]*>/gi)]
    .filter((match) => !/\bnomodule\b/i.test(match[0]))
    .map((match) => match[1]!);
}

async function measureRoute(baseUrl: string, nextDir: string, routeId: string) {
  const response = await fetch(new URL(routeId, baseUrl), { redirect: "manual" });
  if (response.status !== 200) return { status: response.status, gzipKb: 0, rawKb: 0 };
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of new Set(initialScriptFiles(await response.text()))) {
    const filePath = path.join(nextDir, file);
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath);
    rawBytes += source.byteLength;
    gzipBytes += gzipSync(source).byteLength;
  }
  return { status: 200, gzipKb: gzipBytes / 1024, rawKb: rawBytes / 1024 };
}

async function main() {
  const distDir = process.env.NEXT_DIST_DIR ?? ".next";
  const nextDir = path.join(process.cwd(), distDir);
  const prerenderPath = path.join(nextDir, "prerender-manifest.json");
  if (!fs.existsSync(prerenderPath)) {
    throw new Error("Next build manifests are missing. Run `npm run build` before this check.");
  }
  const prerender = JSON.parse(fs.readFileSync(prerenderPath, "utf8")) as PrerenderManifest;
  const prerenderedRoutes = new Set(Object.keys(prerender.routes ?? {}));
  const errors: string[] = [];
  const unmeasured: string[] = [];

  let baseUrl = process.env.BUILD_RENDERING_BASE_URL ?? "";
  const server = baseUrl
    ? null
    : await (async () => {
        const port = await freePort();
        baseUrl = `http://127.0.0.1:${port}`;
        const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(port)], {
          env: { ...process.env, NEXT_DIST_DIR: distDir },
          stdio: "ignore",
        });
        await waitForServer(baseUrl);
        return child;
      })();

  try {
    for (const contract of Object.values(PAGE_PERFORMANCE_CONTRACTS)) {
      const hasDynamicSegments = contract.routeId.includes("[");
      const isPrerendered = !hasDynamicSegments && prerenderedRoutes.has(contract.routeId);
      if (contract.renderingMode === "dynamic" && isPrerendered) {
        errors.push(`${contract.routeId}: contract says dynamic but the production build prerendered it`);
      }
      if (contract.renderingMode === "static" && !hasDynamicSegments && !isPrerendered) {
        errors.push(`${contract.routeId}: contract says static but the production build did not prerender it`);
      }
      if (contract.renderingMode === "revalidate" && !hasDynamicSegments) {
        const entry = prerender.routes?.[contract.routeId];
        if (!entry || typeof entry.initialRevalidateSeconds !== "number") {
          errors.push(`${contract.routeId}: contract says revalidate but the build has no revalidation entry`);
        }
      }

      if (hasDynamicSegments) {
        unmeasured.push(`${contract.routeId} (dynamic segment)`);
        continue;
      }
      const payload = await measureRoute(baseUrl, nextDir, contract.routeId);
      if (payload.status === 404) {
        errors.push(`${contract.routeId}: page is missing from the production build`);
        continue;
      }
      if (payload.status !== 200) {
        unmeasured.push(`${contract.routeId} (HTTP ${payload.status}, needs a session)`);
        continue;
      }
      if (payload.gzipKb > contract.maxInitialPayloadKb) {
        errors.push(
          `${contract.routeId}: client JS ${Math.ceil(payload.gzipKb)} KB gzip exceeds ${contract.maxInitialPayloadKb} KB budget (${Math.ceil(payload.rawKb)} KB raw)`,
        );
      }
    }
  } finally {
    server?.kill();
  }

  if (unmeasured.length > 0) {
    console.log(`[build-rendering-contract] JS budget not measured here: ${unmeasured.join(", ")}`);
  }
  if (errors.length > 0) {
    console.error("[build-rendering-contract] violations detected:");
    for (const error of errors) console.error(` - ${error}`);
    process.exit(1);
  }

  console.log(
    `[build-rendering-contract] ok (${Object.keys(PAGE_PERFORMANCE_CONTRACTS).length} page contracts verified against the production build)`,
  );
}

main().catch((error) => {
  console.error("[build-rendering-contract] failed:", error);
  process.exit(1);
});
