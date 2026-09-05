// Persist only public collection metadata, never upstream error messages or credentials.
export function createPublicationStatus(aggregated, collectedAt, mode = 'live') {
  const reports = aggregated.fetchReports ?? [];
  return {
    mode,
    collected_at: collectedAt,
    coverage_status: reports.length === 0 ? 'unknown' : reports.some(r => r.status !== 'succeeded') ? 'partial' : 'complete',
    sources: reports.map(r => ({
      adapter_id: r.adapterId, source_kind: r.sourceKind, status: r.status,
      fetched_count: r.fetchedCount,
    })),
    missing_sources: reports.filter(r => r.status !== 'succeeded').map(r => r.adapterId),
  };
}

export function publicationFreshness(edition, now) {
  const age = Math.max(0, Date.parse(now) - Date.parse(edition.publishedAt));
  return {
    checked_at: now,
    age_seconds: Math.floor(age / 1000),
    stale: age >= 26 * 60 * 60 * 1000,
    stale_after_hours: 26,
    coverage_status: edition.publication?.coverage_status ?? 'unknown',
  };
}
