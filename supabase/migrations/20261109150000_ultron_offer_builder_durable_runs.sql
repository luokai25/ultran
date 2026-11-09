-- Durable Offer Builder generation runs. The HTML remains the presentation layer;
-- this table records every background step and makes a run resumable after worker restarts.
create table if not exists public.ultron_offer_builder_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.ultron_product_projects(id) on delete cascade,
  requested_stage text not null,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  step_index integer not null default 0 check (step_index >= 0),
  step_results jsonb not null default '{}'::jsonb check (jsonb_typeof(step_results) = 'object'),
  status text not null default 'queued' check (status in ('queued','running','retry_wait','waiting_for_provider','completed','failed','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  result jsonb,
  error_message text,
  current_job_id uuid references public.ultron_jobs(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ultron_offer_builder_runs_idempotency_length check (idempotency_key is null or length(idempotency_key) between 1 and 160),
  constraint ultron_offer_builder_runs_result_object check (result is null or jsonb_typeof(result) = 'object'),
  unique(owner_id, idempotency_key)
);
create index if not exists ultron_offer_builder_runs_owner_project_idx
  on public.ultron_offer_builder_runs(owner_id, project_id, created_at desc);
create index if not exists ultron_offer_builder_runs_status_idx
  on public.ultron_offer_builder_runs(status, updated_at);
alter table public.ultron_offer_builder_runs enable row level security;
drop policy if exists ultron_offer_builder_runs_owner_select on public.ultron_offer_builder_runs;
create policy ultron_offer_builder_runs_owner_select
  on public.ultron_offer_builder_runs for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.ultron_offer_builder_runs from anon, authenticated;
grant select on public.ultron_offer_builder_runs to authenticated;
grant all on public.ultron_offer_builder_runs to service_role;

-- Allow the existing private system worker to claim Offer Builder jobs.
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
      and j.job_type in (
        'maintenance.health_check',
        'memory.consolidate',
        'agent.workflow.execute',
        'connector.tool.execute',
        'product.generate',
        'offer_builder.generate'
      )
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
    set status = 'running',
        attempts = j.attempts + 1,
        lock_token = gen_random_uuid(),
        locked_at = now(),
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,120),15),300))
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select * from claimed;
$function$;
revoke all on function public.ultron_claim_jobs_system(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.ultron_claim_jobs_system(uuid,integer,integer) to service_role;
