import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AggregationPipeline, SourceRegistry, defineSourceAdapter, DEFAULT_SOURCE_DESCRIPTORS } from '../src/index.js';
import { NewsletterEditionStore } from '../src/newsletter/edition-store.js';
import { createPublicationFlow } from '../src/newsletter/publication-flow.js';
import { createNewsletterApiServer } from '../src/newsletter/api.js';

export async function buildDemo(directory) {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/public-sources.json', import.meta.url)));
  const store = new NewsletterEditionStore({ directoryPath: directory });
  for (const day of fixture.days) {
    const registry = new SourceRegistry(['github', 'arxiv'].map(id => defineSourceAdapter({
      descriptor: DEFAULT_SOURCE_DESCRIPTORS.find(d => d.id === id),
      async fetch() {
        if (id === 'arxiv') {
          if (day.failArxiv) throw new Error('Simulated unavailable source');
          return { items: [] };
        }
        const item = { ...fixture.project, summary: day.summary, integrationHint: day.integrationHint,
          publishedAt: day.now, discoveredAt: day.now, metadata: { fetchedAt: day.now } };
        return { items: [item, { ...item, sourceUrl: item.sourceUrl + '?utm_source=fixture' }] };
      },
    })));
    const pipeline = new AggregationPipeline({ registry, editionHistoryStore: store });
    await createPublicationFlow({ pipeline, editionStore: store, now: () => day.now,
      env: { NEWSLETTER_BASE_TIMEZONE: 'UTC' }, mode: 'sample' }).publishEdition();
  }
  return store;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-newsletter-demo-'));
  const store = await buildDemo(directory);
  const server = createNewsletterApiServer({ newsletterStore: store });
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, '127.0.0.1', () => console.log(`Sample JSON API: http://127.0.0.1:${port}/api/newsletter/latest\nFixed March 2026 sample dates intentionally show stale=true. Data: ${directory}`));
}
