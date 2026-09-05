// Scheduler calls the same durable publisher used by Supabase Cron.
const base = process.env.NEWSLETTER_PUBLIC_URL;
const secret = process.env.CRON_SECRET;
if (!base || !secret) throw new Error('NEWSLETTER_PUBLIC_URL and CRON_SECRET are required');
const url = new URL('/api/internal/publish', base);
if (url.protocol !== 'https:') throw new Error('Publication endpoint must use HTTPS');
const response = await fetch(url, {
  method: 'POST', headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(65000),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(`Publication request failed (HTTP ${response.status}); inspect server logs`);
console.log(JSON.stringify({ ok: result.ok, published: result.published, next_run_at: result.next_run_at }));
