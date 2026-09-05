import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base) throw new Error('Pass the deployed base URL');
async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /application\/json/, path);
  return response.json();
}
const latest = await get('/api/newsletter/latest');
assert.equal(typeof latest.freshness.stale, 'boolean');
const history = await get('/api/newsletter/history');
assert.ok(Array.isArray(history.editions));
let checkedItem = null;
if (latest.items.length) {
  checkedItem = latest.items[0].item_id;
  const lifecycle = await get(`/api/newsletter/item/${encodeURIComponent(checkedItem)}`);
  assert.equal(lifecycle.item_id, checkedItem);
  assert.ok(lifecycle.appearances.length > 0);
  assert.ok(latest.items[0].evidence);
}
console.log(JSON.stringify({ base, edition_id: latest.edition_id, item_count: latest.item_count,
  freshness: latest.freshness, coverage: latest.publication?.coverage_status ?? 'unknown', checked_item: checkedItem }, null, 2));
