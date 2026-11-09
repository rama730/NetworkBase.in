import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { cliSchemas, openApiDocument } from "../../src/lib/api/openapi";

// Report A2.11: the generated API description matches the routes' schemas. Fix: npx tsx scripts/api/export-schemas.ts
it("public/api/v1/openapi.json and packages/nb-cli/schema/api.json are up to date", () => {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
  const version = read("packages/nb-cli/package.json").version;
  assert.deepEqual(read("public/api/v1/openapi.json"), JSON.parse(JSON.stringify(openApiDocument(version))));
  assert.deepEqual(read("packages/nb-cli/schema/api.json"), JSON.parse(JSON.stringify(cliSchemas())));
});

it("the CLI's exit codes agree with the error catalog", async () => {
  const { ERROR_CATALOG } = await import("../../src/lib/api/errors");
  const src = fs.readFileSync("packages/nb-cli/lib/errors.mjs", "utf8");
  const exits = { usage: 2, auth: 3, conflict: 4, blocked: 5, needsInput: 6, needsConfirmation: 7, offline: 8, cancelled: 130 } as Record<string, number>;
  const cli = Object.fromEntries([...src.matchAll(/^ {2}([A-Z_]+): EXIT\.(\w+),$/gm)].map(([, code, kind]) => [code!, exits[kind!]!]));
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) assert.equal(cli[code] ?? 1, entry.exit, `${code}: catalog says exit ${entry.exit}`);
});
