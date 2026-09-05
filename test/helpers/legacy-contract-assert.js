// Legacy fixture snapshots cover the pre-1.2 contract. New supplemental metadata
// is checked independently in reliable-consumer-flow.test.js.
import assert from 'node:assert/strict';
function legacy(value) {
  if (Array.isArray(value)) return value.map(legacy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['evidence', 'freshness', 'publication'].includes(key))
    .map(([key, entry]) => [key, legacy(entry)]));
  return value;
}
export default { ...assert, deepEqual(actual, expected, message) {
  assert.deepEqual(legacy(actual), legacy(expected), message);
} };
