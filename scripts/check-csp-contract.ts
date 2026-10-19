import fs from "node:fs";
import path from "node:path";

function assertIncludes(source: string, pattern: RegExp, message: string, errors: string[]) {
  if (!pattern.test(source)) {
    errors.push(message);
  }
}

function main() {
  const root = process.cwd();
  const middlewarePath = path.join(root, "src/proxy.ts");
  const nextConfigPath = path.join(root, "next.config.ts");
  const layoutPath = path.join(root, "src/app/root-document.tsx");
  const siteLayoutPath = path.join(root, "src/app/(site)/layout.tsx");
  const legalDir = path.join(root, "src/app/(legal)");
  const providerPath = path.join(root, "src/components/providers/SecurityRuntimeProvider.tsx");
  const turnstilePath = path.join(root, "src/components/auth/TurnstileWidget.tsx");

  const middlewareSource = fs.readFileSync(middlewarePath, "utf8");
  const nextConfigSource = fs.readFileSync(nextConfigPath, "utf8");
  const layoutSource = fs.readFileSync(layoutPath, "utf8");
  const siteLayoutSource = fs.readFileSync(siteLayoutPath, "utf8");
  const providerSource = fs.readFileSync(providerPath, "utf8");
  const turnstileSource = fs.readFileSync(turnstilePath, "utf8");

  const errors: string[] = [];

  assertIncludes(middlewareSource, /Content-Security-Policy/, "src/proxy.ts must set Content-Security-Policy", errors);
  if (/Content-Security-Policy/.test(nextConfigSource)) {
    errors.push("next.config.ts must not define a second Content-Security-Policy; src/proxy.ts is the single owner");
  }
  if (/script-src[^\n]*unsafe-inline/.test(middlewareSource)) {
    errors.push("middleware script-src must not allow unsafe-inline");
  }
  if ((middlewareSource.match(/'unsafe-inline'/g) ?? []).length !== 2 || !/: \["'self'", "'unsafe-inline'"/.test(middlewareSource)) {
    errors.push("src/proxy.ts may allow script unsafe-inline only in the nonce-less static legal page branch");
  }
  const legalPaths = [...(middlewareSource.match(/STATIC_LEGAL_PATHS = new Set\(\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  const legalPages = fs.readdirSync(legalDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(legalDir, entry.name, "page.tsx")))
    .map((entry) => `/${entry.name}`)
    .sort();
  if (legalPaths.join() !== legalPages.join()) {
    errors.push(`src/proxy.ts STATIC_LEGAL_PATHS must list exactly the src/app/(legal) pages: ${legalPages.join(", ")}`);
  }
  assertIncludes(middlewareSource, /x-nonce/, "src/proxy.ts must forward a nonce header", errors);
  assertIncludes(middlewareSource, /CSRF_COOKIE_NAME/, "src/proxy.ts must issue the CSRF cookie", errors);
  assertIncludes(siteLayoutSource, /headers\(\)/, "src/app/(site)/layout.tsx must read the CSP nonce from request headers", errors);
  assertIncludes(layoutSource, /SecurityRuntimeProvider/, "src/app/root-document.tsx must wrap the app in SecurityRuntimeProvider", errors);
  assertIncludes(layoutSource, /nonce=\{nonce\}/, "src/app/root-document.tsx must nonce the inline theme script", errors);
  // The provider patches fetch through the shared CSRF client, which owns the header.
  const csrfClientSource = fs.readFileSync(path.join(root, "src/lib/security/csrf-client.ts"), "utf8");
  assertIncludes(csrfClientSource, /CSRF_HEADER_NAME/, "the CSRF client must attach the CSRF header", errors);
  assertIncludes(providerSource, /createCsrfFetch\(/, "SecurityRuntimeProvider must attach the CSRF header through createCsrfFetch", errors);
  assertIncludes(providerSource, /window\.fetch = createCsrfFetch/, "SecurityRuntimeProvider must patch same-origin browser fetch calls", errors);
  assertIncludes(turnstileSource, /nonce=\{nonce \?\? undefined\}/, "TurnstileWidget must pass the CSP nonce to next/script", errors);
  assertIncludes(middlewareSource, /https:\/\/accounts\.google\.com/, "middleware CSP must permit Google Identity Services", errors);
  assertIncludes(
    middlewareSource,
    /media-src 'self' blob: https:/,
    "middleware CSP must permit authorized same-origin, preview-blob and HTTPS media playback",
    errors,
  );
  assertIncludes(
    middlewareSource,
    /frame-src 'self'[^\n]*blob:/,
    "middleware CSP must permit same-origin and blob PDF frames",
    errors,
  );
  assertIncludes(
    middlewareSource,
    /worker-src 'self' blob:/,
    "middleware CSP must permit bundled and blob workers",
    errors,
  );
  const builtProxyPath = path.join(root, process.env.NEXT_DIST_DIR || ".next", "server/middleware.js");
  if (fs.existsSync(builtProxyPath)) {
    assertIncludes(fs.readFileSync(builtProxyPath, "utf8"), /Content-Security-Policy/, "the built proxy must set Content-Security-Policy", errors);
  }

  if (errors.length > 0) {
    console.error("[csp-contract] failed:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log("[csp-contract] ok");
}

main();
