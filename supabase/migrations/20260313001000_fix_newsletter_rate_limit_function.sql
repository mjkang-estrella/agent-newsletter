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
