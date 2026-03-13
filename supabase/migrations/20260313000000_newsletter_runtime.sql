create table if not exists public.newsletter_editions (
  id text primary key,
  published_at timestamptz not null unique,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists newsletter_editions_published_at_desc_idx
  on public.newsletter_editions (published_at desc);

create table if not exists public.newsletter_runtime_state (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.newsletter_publication_runs (
  id bigint generated always as identity primary key,
  slot timestamptz not null unique,
  status text not null check (status in ('running', 'completed', 'failed')),
  forced boolean not null default false,
  edition_id text references public.newsletter_editions (id) on delete set null,
  error jsonb,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz
);

create index if not exists newsletter_publication_runs_started_at_desc_idx
  on public.newsletter_publication_runs (started_at desc);

create table if not exists public.newsletter_rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.newsletter_consumer_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default timezone('utc', now()),
  consumer_id text not null,
  identity_source text not null,
  declared_id text,
  user_agent text,
  client_ip text,
  method text not null,
  path text not null,
  outcome text not null check (outcome in ('successful', 'throttled')),
  rate_limit jsonb,
  metadata jsonb
);

create index if not exists newsletter_consumer_events_occurred_at_desc_idx
  on public.newsletter_consumer_events (occurred_at desc);

create index if not exists newsletter_consumer_events_consumer_id_occurred_at_desc_idx
  on public.newsletter_consumer_events (consumer_id, occurred_at desc);

create or replace function public.consume_newsletter_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer,
  p_now timestamptz default timezone('utc', now())
)
returns table (
  key text,
  count integer,
  remaining integer,
  limited boolean,
  reset_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with upserted as (
    insert into public.newsletter_rate_limits as rl (
      key,
      count,
      reset_at,
      updated_at
    )
    values (
      p_key,
      1,
      p_now + ((greatest(p_window_ms, 1))::text || ' milliseconds')::interval,
      p_now
    )
    on conflict (key) do update
      set count = case
        when rl.reset_at <= p_now then 1
        else rl.count + 1
      end,
      reset_at = case
        when rl.reset_at <= p_now
          then p_now + ((greatest(p_window_ms, 1))::text || ' milliseconds')::interval
        else rl.reset_at
      end,
      updated_at = p_now
    returning rl.key, rl.count, rl.reset_at
  )
  select
    upserted.key,
    upserted.count,
    greatest(p_limit - upserted.count, 0) as remaining,
    (upserted.count > p_limit) as limited,
    upserted.reset_at
  from upserted;
$$;
