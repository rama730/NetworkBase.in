// Writes public/api/v1/openapi.json and packages/nb-cli/schema/api.json from src/lib/api/v1-schemas.ts.
import fs from "node:fs";
import path from "node:path";

import { cliSchemas, openApiDocument } from "../../src/lib/api/openapi";

const root = process.cwd();
const version = JSON.parse(fs.readFileSync(path.join(root, "packages/nb-cli/package.json"), "utf8")).version;
const write = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${file}`);
};
write("public/api/v1/openapi.json", openApiDocument(version));
write("packages/nb-cli/schema/api.json", cliSchemas());

// The CLI's command table for /docs/cli (report A9.10): the docs list exactly what `nb help --json` lists.
void import("../../packages/nb-cli/lib/args.mjs").then(({ helpData }) => write("src/lib/cli/commands.json", helpData()));
