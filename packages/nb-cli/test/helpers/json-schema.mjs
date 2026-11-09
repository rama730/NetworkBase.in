// The few JSON Schema keywords zod's toJSONSchema emits for the API's request bodies (schema/api.json), so the fake
// server can refuse a body the real server would (report A2.11). Returns a list of problems; empty = valid.

/** @param {any} schema @param {any} value @param {string} [at] @returns {string[]} */
export function validate(schema, value, at = "body") {
  if (schema === true || schema === undefined || schema === null) return [];
  if (schema === false) return [`${at}: not allowed`];
  /** @type {string[]} */
  const errors = [];
  const typeOf = (/** @type {any} */ v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (schema.anyOf && !schema.anyOf.some((/** @type {any} */ s) => validate(s, value, at).length === 0)) errors.push(`${at}: matches none of the allowed shapes`);
  if (schema.oneOf && schema.oneOf.filter((/** @type {any} */ s) => validate(s, value, at).length === 0).length !== 1) errors.push(`${at}: must match exactly one shape`);
  for (const s of schema.allOf ?? []) errors.push(...validate(s, value, at));
  if ("const" in schema && value !== schema.const) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = types.some((/** @type {string} */ t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) return [...errors, `${at}: expected ${types.join("|")}, got ${actual}`];
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: doesn't match ${schema.pattern}`);
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${at}: not a date-time`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${at}: must be above ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${at}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], v, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${key}: not allowed`);
      else if (typeof schema.additionalProperties === "object") errors.push(...validate(schema.additionalProperties, v, `${at}.${key}`));
    }
  }
  return errors;
}
