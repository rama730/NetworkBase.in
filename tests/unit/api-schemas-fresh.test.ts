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
