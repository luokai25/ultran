create or replace function public.ultron_claim_jobs(
  p_limit integer default 1,
  p_lease_seconds integer default 90
)
returns setof public.ultron_jobs
language sql
security invoker
set search_path = pg_catalog, public
as $function$
  with exhausted as (
    update public.ultron_jobs j
    set status = 'failed',
        error_message = coalesce(j.error_message, 'Worker lease expired after retry budget was exhausted.'),
        lock_token = null,
        lease_expires_at = null,
        completed_at = now(),
        updated_at = now()
    where j.owner_id = (select auth.uid())
      and j.status = 'running'
      and j.lease_expires_at < now()
      and j.attempts >= j.max_attempts
    returning j.id
  ),
  candidates as (
    select j.id
    from public.ultron_jobs j
    where j.owner_id = (select auth.uid())
      and (
        (j.status in ('queued','retry_wait') and j.run_after <= now())
        or (j.status = 'running' and j.lease_expires_at < now())
      )
      and j.attempts < j.max_attempts
    order by j.priority desc, j.run_after asc, j.created_at asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,1),1),5)
  ),
  claimed as (
    update public.ultron_jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        lock_token = gen_random_uuid(),
        locked_at = now(),
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,90),15),300))
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select * from claimed;
$function$;
revoke all on function public.ultron_claim_jobs(integer,integer) from public, anon;
grant execute on function public.ultron_claim_jobs(integer,integer) to authenticated;
