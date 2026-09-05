import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDemo } from '../examples/demo.js';
import { reviewEditions, consume } from '../examples/consumer.js';
import { serializeNewsletterEdition } from '../src/newsletter/edition.js';
import { createNewsletterApiServer } from '../src/newsletter/api.js';
import { createPublicationFlow } from '../src/newsletter/publication-flow.js';
import { publicationFreshness } from '../src/newsletter/publication-status.js';

test('fixture ingestion, stable identity, partial publication and consumer checkpoint over HTTP', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'newsletter-e2e-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await buildDemo(directory);
  const editions = (await store.loadHistory({ now: '2026-03-12T22:00:00Z' })).reverse().map(e => serializeNewsletterEdition(e));
  assert.equal(editions.length, 2);
  assert.equal(editions[0].item_count, 1, 'tracking URL duplicates collapse');
  assert.equal(editions[0].items[0].item_id, editions[1].items[0].item_id);
  assert.equal(editions[1].items[0].edition_count, 2);
  assert.equal(editions[1].publication.mode, 'sample');
  assert.equal(editions[0].publication.coverage_status, 'complete');
  assert.equal(editions[1].publication.coverage_status, 'partial');
  assert.deepEqual(editions[1].publication.missing_sources, ['arxiv']);
  assert.equal(editions[1].items[0].evidence.collected_at, '2026-03-12T21:00:00.000Z');
  assert.match(editions[1].items[0].evidence.novelty_reason, /novel/);
  assert.match(editions[1].items[0].evidence.uncertainty, /unverified/);
  const first = reviewEditions([editions[0]], undefined, 'browser research');
  assert.equal(first.reviews[0].change, 'new_to_consumer');
  const second = reviewEditions([editions[1]], first.state, 'browser research');
  assert.equal(second.reviews[0].change, 'material_change');
  assert.deepEqual(second.reviews[0].changed_fields, ['summary', 'integration_hint']);
  assert.equal(reviewEditions(editions, second.state).reviews.length, 0);
  const unchanged = structuredClone(editions[1]);
  unchanged.published_at = '2026-03-13T21:00:00.000Z';
  unchanged.items[0].relevance_score = 99;
  assert.equal(reviewEditions([unchanged], second.state).reviews.length, 0, 'score drift is not material');
  assert.equal(reviewEditions(editions, undefined, 'unrelated payroll').reviews.length, 0);
  const server = createNewsletterApiServer({ newsletterStore: store, now: () => '2026-03-15T22:00:00.000Z' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = await consume(base, first.state, 'browser research');
  assert.equal(result.freshness.stale, true);
  assert.equal(result.sample, true);
  assert.equal(result.reviews[0].change, 'material_change');
  const lifecycle = await (await fetch(`${base}/api/newsletter/item/${editions[0].items[0].item_id}`)).json();
  assert.equal(lifecycle.appearances.length, 2);
  await assert.rejects(createPublicationFlow({ editionStore: store, now: () => '2026-03-13T21:00:00Z', pipeline: { aggregate() { throw new Error('all sources unavailable'); } } }).publishEdition(), /unavailable/);
  assert.equal((await store.loadLatest()).publishedAt, '2026-03-12T21:00:00.000Z');
  const gap = await consume(base, { items: {}, last_published_at: '2026-01-01T00:00:00Z' }, 'browser');
  assert.equal(gap.history_gap, true);
});

test('legacy publication has unknown coverage and stale boundary is explicit', () => {
  const edition = { publishedAt: '2026-03-12T21:00:00Z' };
  assert.equal(publicationFreshness(edition, '2026-03-13T22:59:59Z').stale, false);
  assert.equal(publicationFreshness(edition, '2026-03-13T23:00:00Z').stale, true);
  assert.equal(publicationFreshness(edition, '2026-03-13T23:00:00Z').coverage_status, 'unknown');
});

test('a stalled source becomes missing coverage while a healthy source completes', async () => {
  const { ContentFetcherCore } = await import('../src/core/content-fetcher.js');
  const { SourceRegistry, defineSourceAdapter, DEFAULT_SOURCE_DESCRIPTORS } = await import('../src/index.js');
  const registry = new SourceRegistry(['github', 'arxiv'].map(id => defineSourceAdapter({
    descriptor: DEFAULT_SOURCE_DESCRIPTORS.find(d => d.id === id),
    fetch: () => id === 'github' ? { items: [] } : new Promise(() => {}),
  })));
  const result = await new ContentFetcherCore({ registry, adapterTimeoutMs: 5 }).fetch({ now: '2026-03-12T21:00:00Z' });
  assert.equal(result.fetchVerification.status, 'partial');
  assert.equal(result.fetchReports[1].status, 'failed');
});
