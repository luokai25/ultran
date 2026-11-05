create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.ultron_maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  maintenance_key text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_id, maintenance_key, scheduled_for)
);
alter table public.ultron_maintenance_runs enable row level security;
drop policy if exists ultron_maintenance_runs_owner_select on public.ultron_maintenance_runs;
create policy ultron_maintenance_runs_owner_select on public.ultron_maintenance_runs
  for select to authenticated using ((select auth.uid()) = owner_id);
grant select on public.ultron_maintenance_runs to authenticated;

create or replace function public.ultron_enqueue_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_now timestamptz := date_trunc('minute', now());
  v_queued integer := 0;
begin
  select owner_id into v_owner from public.ultron_instance where id = true limit 1;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'instance_not_configured');
  end if;

  update public.ultron_jobs
     set status = 'retry_wait',
         run_after = now(),
         lock_token = null,
         locked_at = null,
         lease_expires_at = null,
         heartbeat_at = null,
         error_message = coalesce(error_message, 'Worker lease expired; returned to queue'),
         updated_at = now()
   where owner_id = v_owner
     and status = 'running'
     and lease_expires_at < now()
     and attempts < max_attempts;

  update public.ultron_jobs
     set status = 'failed',
         lock_token = null,
         locked_at = null,
         lease_expires_at = null,
         heartbeat_at = null,
         error_message = coalesce(error_message, 'Worker lease expired after final attempt'),
         completed_at = now(),
         updated_at = now()
   where owner_id = v_owner
     and status = 'running'
     and lease_expires_at < now()
     and attempts >= max_attempts;

  insert into public.ultron_jobs(owner_id, job_type, title, payload, priority, run_after, max_attempts, idempotency_key)
  values
    (v_owner, 'maintenance.health_check', 'Cloud infrastructure health check',
     jsonb_build_object('scheduled_for', v_now), -5, now(), 3, 'maintenance:health:' || to_char(v_now, 'YYYYMMDDHH24MI')),
    (v_owner, 'memory.consolidate', 'Consolidate durable memory',
     jsonb_build_object('scheduled_for', date_trunc('day', now())), -8, now(), 2, 'maintenance:memory:' || to_char(date_trunc('day', now()), 'YYYYMMDD'))
  on conflict do nothing;
  get diagnostics v_queued = row_count;

  insert into public.ultron_maintenance_runs(owner_id, maintenance_key, scheduled_for, status, details)
  values (v_owner, 'queue_recovery', v_now, 'completed',
          jsonb_build_object('expired_requeued', (select count(*) from public.ultron_jobs where owner_id=v_owner and status='retry_wait' and updated_at >= now() - interval '1 minute'),
                             'expired_failed', (select count(*) from public.ultron_jobs where owner_id=v_owner and status='failed' and completed_at >= now() - interval '1 minute')))
  on conflict do nothing;

  delete from public.ultron_jobs
   where owner_id = v_owner
     and status in ('completed','cancelled')
     and coalesce(completed_at, updated_at) < now() - interval '30 days';

  return jsonb_build_object('ok', true, 'maintenance_jobs_queued', v_queued, 'checked_at', now());
end;
$$;

revoke all on function public.ultron_enqueue_maintenance() from public, anon, authenticated;

select cron.schedule('ultron-maintenance-queue', '*/5 * * * *', $$select public.ultron_enqueue_maintenance();$$);
