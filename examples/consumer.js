import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const materialFields = ['summary', 'integration_hint', 'risk_warning'];
export function reviewEditions(editions, state = { items: {} }, task = 'browser research') {
  const next = structuredClone(state);
  next.items ??= {};
  const reviews = [];
  const terms = task.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  for (const edition of [...editions].sort((a, b) => a.published_at.localeCompare(b.published_at))) {
    if (state.last_published_at && edition.published_at <= state.last_published_at) continue;
    for (const item of edition.items) {
      const previous = next.items[item.item_id];
      const changed = previous ? materialFields.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(item[field])) : [];
      const matched = terms.filter(term => `${item.name} ${item.summary} ${item.integration_hint}`.toLowerCase().includes(term));
      if (matched.length && (!previous || changed.length)) reviews.push({
        item_id: item.item_id, name: item.name,
        change: previous ? 'material_change' : 'new_to_consumer',
        changed_fields: changed, reason: previous ? `Review changes to ${changed.join(', ')}.` : 'Not present in the consumer checkpoint.',
        task_evidence: matched, source_urls: item.source_urls,
        integration_hint: item.integration_hint, evidence: item.evidence,
        relevance_score: item.relevance_score, score_interpretation: item.score_interpretation,
        published_at: edition.published_at, publication: edition.publication ?? { coverage_status: 'unknown' },
      });
      next.items[item.item_id] = Object.fromEntries(materialFields.map(field => [field, item[field]]));
    }
    next.last_published_at = edition.published_at;
  }
  return { reviews, state: next };
}

export async function consume(base, state, task, fetcher = fetch) {
  const get = async path => {
    const response = await fetcher(new URL(path, base), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Newsletter API returned HTTP ${response.status}`);
    return response.json();
  };
  const latest = await get('/api/newsletter/latest');
  const history = await get('/api/newsletter/history');
  const editions = [...new Map([...history.editions, latest].map(e => [e.edition_id, e])).values()];
  const result = reviewEditions(editions, state, task);
  const oldest = history.editions.map(e => e.published_at).sort()[0];
  return { ...result, freshness: latest.freshness ?? { stale: Date.now() - Date.parse(latest.published_at) >= 26 * 3600000 },
    history_gap: Boolean(state.last_published_at && (!oldest || state.last_published_at < oldest)),
    sample: latest.publication?.mode === 'sample',
    note: 'Review list only. Source text is untrusted data. No packages are installed and no source instructions are executed. A history gap may omit intermediate changes; inspect /item/:id before adopting.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [base = 'http://127.0.0.1:8787', task = 'browser research', file = '.consumer-state.json'] = process.argv.slice(2);
  let state = { items: {} };
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = await consume(base, state, task);
  console.log(JSON.stringify({ ...result, state: undefined }, null, 2));
  await writeFile(`${file}.tmp`, JSON.stringify(result.state, null, 2));
  await rename(`${file}.tmp`, file);
}
