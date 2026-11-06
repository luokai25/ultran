create or replace function public.ultron_claim_jobs_system(
  p_owner_id uuid,
  p_limit integer default 2,
  p_lease_seconds integer default 120
)
returns setof public.ultron_jobs
language sql
security definer
set search_path = pg_catalog, public
as $function$
  with candidates as (
    select j.id
    from public.ultron_jobs j
    where j.owner_id = p_owner_id
      and j.job_type in ('maintenance.health_check','memory.consolidate','agent.workflow.execute','connector.tool.execute')
      and (
        (j.status in ('queued','retry_wait') and j.run_after <= now())
        or (j.status = 'running' and j.lease_expires_at < now())
      )
      and j.attempts < j.max_attempts
    order by j.priority desc, j.run_after asc, j.created_at asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,2),1),5)
  ), claimed as (
    update public.ultron_jobs j
    set status = 'running', attempts = j.attempts + 1, lock_token = gen_random_uuid(),
        locked_at = now(), heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,120),15),300))
    from candidates c where j.id = c.id returning j.*
  ) select * from claimed;
$function$;
revoke all on function public.ultron_claim_jobs_system(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.ultron_claim_jobs_system(uuid,integer,integer) to service_role;
