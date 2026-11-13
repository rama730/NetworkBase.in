"use strict";

const http = require("node:http");
const path = require("node:path");

function resolveIsWorker(env = process.env) {
  const role = (env.INNGEST_EXECUTION_ROLE || "").trim().toLowerCase();
  const nbRole = (env.NB_SERVICE_ROLE || "").trim().toLowerCase();
  const serviceName = (env.RAILWAY_SERVICE_NAME || "").trim().toLowerCase();
  return (
    nbRole === "worker" ||
    serviceName === "networkbase-worker" ||
    (role === "worker" && serviceName !== "networkbase-web" && nbRole !== "web")
  );
}

const LIVE_RESPONSE_BODY = JSON.stringify({
  success: true,
  data: { status: "ok", probe: "liveness" },
});

const WORKER_NOT_FOUND_BODY = JSON.stringify({
  success: false,
  error: "Not Found",
});

const WORKER_METHOD_NOT_ALLOWED_BODY = JSON.stringify({
  success: false,
  error: "Method Not Allowed",
});

const MAX_INNGEST_BODY_BYTES = 32 * 1024 * 1024;

const SCANNER_EXACT_PATHS = new Set([
  "/graphql",
  "/api/graphql",
  "/v1/graphql",
  "/altair",
  "/graphiql",
  "/playground",
  "/console",
  "/console/",
  "/xmlrpc.php",
  "/composer.json",
  "/composer.lock",
  "/package.json",
  "/package-lock.json",
  "/yarn.lock",
  "/pnpm-lock.yaml",
  "/tsconfig.json",
  "/swagger.json",
  "/crossdomain.xml",
  "/autodiscover/autodiscover.xml",
  "/server-status",
  "/server-info",
  "/_all_dbs",
  "/login.action",
]);
const SCANNER_PREFIX_PATHS = [
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/wp-includes",
  "/actuator",
  "/phpmyadmin",
  "/cgi-bin",
  "/vendor/phpunit",
];
const SCANNER_EXTENSION_RE = /\.(?:php|asp|aspx|jsp|cgi|env|map)$/i;

function isScannerProbePath(pathname) {
  const lower = pathname.toLowerCase();
  if (lower.startsWith("/.") && !lower.startsWith("/.well-known/")) return true;
  if (SCANNER_EXACT_PATHS.has(lower)) return true;
  if (SCANNER_PREFIX_PATHS.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))) return true;
  if (!lower.startsWith("/api/") && !lower.startsWith("/u/") && !lower.startsWith("/workspaces/") && SCANNER_EXTENSION_RE.test(lower)) {
    return true;
  }
  return false;
}

function handleFastPathOrWorkerGuard(req, res, isWorker) {
  if (!req || !res || typeof req.url !== "string") return false;
  const queryIndex = req.url.indexOf("?");
  const pathname = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex);

  if (pathname === "/api/v1/live" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(LIVE_RESPONSE_BODY),
    });
    res.end(req.method === "HEAD" ? undefined : LIVE_RESPONSE_BODY);
    return true;
  }

  if (isScannerProbePath(pathname)) {
    res.writeHead(404, {
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "content-length": "0",
    });
    res.end();
    return true;
  }

  if (isWorker && pathname !== "/api/inngest" && !pathname.startsWith("/api/inngest/")) {
    res.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(WORKER_NOT_FOUND_BODY),
    });
    res.end(req.method === "HEAD" ? undefined : WORKER_NOT_FOUND_BODY);
    return true;
  }

  return false;
}

// ponytail: intercept /api/v1/live liveness probes and non-Inngest worker traffic at the raw node:http socket layer before Next.js routing, proxy, or /_not-found bundle evaluation. ceiling: single-process standalone server. upgrade: merge worker into web (INNGEST_EXECUTION_ROLE=worker on web) and pause networkbase-worker.
function installProductionHttpPatch(env = process.env) {
  const isWorker = resolveIsWorker(env);
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function patchedEmit(event, req, res, ...rest) {
    if (event === "request" && handleFastPathOrWorkerGuard(req, res, isWorker)) {
      return true;
    }
    return originalEmit.call(this, event, req, res, ...rest);
  };
  return () => {
    http.Server.prototype.emit = originalEmit;
  };
}

function readBoundedRequestBody(req, maxBytes = MAX_INNGEST_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("Request body exceeds worker limit"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
    req.on("error", reject);
  });
}

function runWithAfterFallback(inngestMod, fn) {
  const workStorage = inngestMod && inngestMod.workAsyncStorage;
  const workUnitStorage = inngestMod && inngestMod.workUnitAsyncStorage;
  if (workStorage && typeof workStorage.run === "function" && workUnitStorage && typeof workUnitStorage.run === "function") {
    const workStore = {
      page: "/api/inngest/route",
      afterContext: {
        after(task) {
          Promise.resolve()
            .then(task)
            .catch((err) => console.error("[worker:after]", err));
        },
      },
    };
    const workUnitStore = { type: "request", phase: "action" };
    return workStorage.run(workStore, () => workUnitStorage.run(workUnitStore, fn));
  }
  return fn();
}

// ponytail: run networkbase-worker on a minimal node:http server that lazy-loads only /api/inngest/route.js without booting next-server.js (~36 MB RSS at boot, ~96 MB RSS after loading all 38 worker functions). ceiling: serves /api/v1/live and /api/inngest only. upgrade: set NB_FORCE_FULL_NEXT_WORKER=true if worker ever needs additional Next.js routes.
function createLightweightWorkerServer(options = {}) {
  const inngestRoutePath =
    options.inngestRoutePath || path.join(__dirname, ".next", "server", "app", "api", "inngest", "route.js");
  let cachedInngestModule = null;

  function getInngestModule() {
    if (!cachedInngestModule) {
      cachedInngestModule = require(inngestRoutePath);
    }
    return cachedInngestModule;
  }

  return http.createServer(async (req, res) => {
    try {
      if (handleFastPathOrWorkerGuard(req, res, true)) {
        return;
      }

      const method = (req.method || "GET").toUpperCase();
      const inngestMod = getInngestModule();
      const userland = inngestMod.routeModule ? inngestMod.routeModule.userland : inngestMod;
      const handler = userland[method];

      if (typeof handler !== "function") {
        res.writeHead(405, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(WORKER_METHOD_NOT_ALLOWED_BODY),
        });
        res.end(method === "HEAD" ? undefined : WORKER_METHOD_NOT_ALLOWED_BODY);
        return;
      }

      const proto = (req.headers["x-forwarded-proto"] || "http").toString().split(",")[0].trim() || "http";
      const host = (req.headers["x-forwarded-host"] || req.headers.host || "127.0.0.1:3000")
        .toString()
        .split(",")[0]
        .trim();
      const fullUrl = `${proto}://${host}${req.url || "/api/inngest"}`;

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else if (typeof value === "string") {
          headers.set(key, value);
        }
      }

      const hasBody = method !== "GET" && method !== "HEAD";
      const bodyBuffer = hasBody ? await readBoundedRequestBody(req) : undefined;
      const webReq = new Request(fullUrl, {
        method,
        headers,
        body: bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined,
      });

      const webRes = await runWithAfterFallback(inngestMod, () => handler(webReq));
      const outHeaders = {};
      webRes.headers.forEach((val, key) => {
        outHeaders[key] = val;
      });
      const resBuffer = Buffer.from(await webRes.arrayBuffer());
      outHeaders["content-length"] = resBuffer.byteLength;
      res.writeHead(webRes.status || 200, outHeaders);
      res.end(method === "HEAD" ? undefined : resBuffer);
    } catch (error) {
      console.error("[worker:http]", error);
      if (!res.headersSent) {
        const body = JSON.stringify({ success: false, error: "Internal Server Error" });
        res.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(body),
        });
        res.end(body);
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

if (require.main === module) {
  process.env.NODE_ENV = "production";
  process.chdir(__dirname);

  const isWorker = resolveIsWorker(process.env);
  if (isWorker && process.env.NB_FORCE_FULL_NEXT_WORKER !== "true") {
    const port = parseInt(process.env.PORT, 10) || 3000;
    const hostname = process.env.HOSTNAME || "0.0.0.0";
    const keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);
    const server = createLightweightWorkerServer();
    if (Number.isFinite(keepAliveTimeout) && keepAliveTimeout >= 0) {
      server.keepAliveTimeout = keepAliveTimeout;
    }
    server.listen(port, hostname, () => {
      console.info(`[worker] lightweight Inngest server listening on http://${hostname}:${port}`);
    });
  } else {
    installProductionHttpPatch(process.env);
    require("./server.js");
  }
}

module.exports = {
  resolveIsWorker,
  isScannerProbePath,
  handleFastPathOrWorkerGuard,
  installProductionHttpPatch,
  createLightweightWorkerServer,
};
