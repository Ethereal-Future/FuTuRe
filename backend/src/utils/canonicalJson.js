/**
 * Deterministic JSON serialization: object keys are sorted recursively so
 * semantically identical payloads always produce the same string (and hash),
 * regardless of the key order the client used.
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value === undefined ? null : value)) ?? 'null';
}
