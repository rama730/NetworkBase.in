import assert from "node:assert/strict";
import { test } from "node:test";

import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import * as schema from "../../src/lib/db/schema";

// Two properties mapped to one database column make every INSERT fail ("specified more than once").
test("no table maps two properties to the same database column", () => {
  const duplicates: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const seen = new Map<string, string>();
    for (const [property, column] of Object.entries(getTableColumns(value))) {
      const previous = seen.get(column.name);
      if (previous) duplicates.push(`${getTableName(value)}.${column.name}: ${previous} and ${property}`);
      seen.set(column.name, property);
    }
  }
  assert.deepEqual(duplicates, []);
});
