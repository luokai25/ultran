create table if not exists public.ultron_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null check (job_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  title text not null check (length(btrim(title)) between 1 and 180),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  priority smallint not null default 0 check (priority between -10 and 10),
  status text not null default 'queued' check (status in ('queued','running','retry_wait','completed','failed','cancelled')),
  run_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  lock_token uuid,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  idempotency_key text,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ultron_jobs_idempotency_key_length check (idempotency_key is null or length(idempotency_key) between 1 and 160),
  constraint ultron_jobs_result_object check (result is null or jsonb_typeof(result) = 'object')
);
create index if not exists ultron_jobs_owner_status_due_idx on public.ultron_jobs(owner_id, status, priority desc, run_after, created_at);
create index if not exists ultron_jobs_expired_lease_idx on public.ultron_jobs(lease_expires_at) where status = 'running';
create unique index if not exists ultron_jobs_owner_idempotency_uidx on public.ultron_jobs(owner_id, idempotency_key) where idempotency_key is not null;
alter table public.ultron_jobs enable row level security;
drop policy if exists ultron_jobs_owner_select on public.ultron_jobs;
create policy ultron_jobs_owner_select on public.ultron_jobs for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists ultron_jobs_owner_insert on public.ultron_jobs;
create policy ultron_jobs_owner_insert on public.ultron_jobs for insert to authenticated with check (owner_id = (select auth.uid()) and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid())));
drop policy if exists ultron_jobs_owner_update on public.ultron_jobs;
create policy ultron_jobs_owner_update on public.ultron_jobs for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid())));
drop trigger if exists ultron_jobs_set_updated_at on public.ultron_jobs;
create trigger ultron_jobs_set_updated_at before update on public.ultron_jobs for each row execute function public.ultron_set_updated_at();
create or replace function public.ultron_claim_jobs(p_limit integer default 1, p_lease_seconds integer default 90)
returns setof public.ultron_jobs language sql security invoker set search_path = pg_catalog, public
as $function$
  with candidates as (
    select j.id from public.ultron_jobs j
    where j.owner_id = (select auth.uid())
      and ((j.status in ('queued','retry_wait') and j.run_after <= now()) or (j.status = 'running' and j.lease_expires_at < now()))
      and j.attempts < j.max_attempts
    order by j.priority desc, j.run_after asc, j.created_at asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,1),1),5)
  ), claimed as (
    update public.ultron_jobs j
    set status='running', attempts=j.attempts+1, lock_token=gen_random_uuid(),
        locked_at=now(), heartbeat_at=now(),
        lease_expires_at=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,90),15),300))
    from candidates c where j.id=c.id returning j.*
  ) select * from claimed;
$function$;
revoke all on function public.ultron_claim_jobs(integer,integer) from public, anon;
grant execute on function public.ultron_claim_jobs(integer,integer) to authenticated;
grant select, insert, update on public.ultron_jobs to authenticated;
alter publication supabase_realtime add table public.ultron_jobs;
