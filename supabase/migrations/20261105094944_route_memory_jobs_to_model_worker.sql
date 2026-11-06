-- Keep semantic memory consolidation on the model-backed Edge Function worker.
-- The SQL maintenance worker has no model and must never claim or fail memory jobs.
create or replace function public.ultron_process_cloud_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_job record;
  v_processed integer := 0;
  v_health jsonb;
begin
  select owner_id into v_owner
    from public.ultron_instance
   where id = true
   limit 1;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'instance_not_configured');
  end if;

  for v_job in
    select id
      from public.ultron_jobs
     where owner_id = v_owner
       and status in ('queued', 'retry_wait')
       and run_after <= now()
       and job_type = 'maintenance.health_check'
     order by priority desc, created_at asc
     for update skip locked
     limit 5
  loop
    update public.ultron_jobs
       set status = 'running',
           attempts = attempts + 1,
           lock_token = gen_random_uuid(),
           locked_at = now(),
           heartbeat_at = now(),
           lease_expires_at = now() + interval '90 seconds',
           updated_at = now()
     where id = v_job.id
       and owner_id = v_owner;

    select jsonb_build_object(
      'checked_at', now(),
      'database', 'reachable',
      'tables', jsonb_build_object(
        'conversations', (select count(*) from public.ultron_conversations where owner_id = v_owner),
        'messages', (select count(*) from public.ultron_messages where owner_id = v_owner),
        'memories', (select count(*) from public.ultron_memory_items where owner_id = v_owner),
        'queued_jobs', (select count(*) from public.ultron_jobs where owner_id = v_owner and status in ('queued', 'retry_wait')),
        'running_jobs', (select count(*) from public.ultron_jobs where owner_id = v_owner and status = 'running'),
        'artifacts', (select count(*) from public.ultron_artifacts where owner_id = v_owner),
        'connectors', (select count(*) from public.ultron_connector_connections where owner_id = v_owner)
      ),
      'storage_bucket_present', exists(select 1 from storage.buckets where id = 'ultron-private'),
      'worker', 'maintenance-v2-model-memory-routing'
    ) into v_health;

    update public.ultron_jobs
       set status = 'completed',
           result = v_health,
           error_message = null,
           completed_at = now(),
           lock_token = null,
           locked_at = null,
           heartbeat_at = null,
           lease_expires_at = null,
           updated_at = now()
     where id = v_job.id
       and owner_id = v_owner
       and status = 'running';

    insert into public.ultron_maintenance_runs(owner_id, maintenance_key, scheduled_for, status, details, completed_at)
    values (v_owner, 'health_check', date_trunc('minute', now()), 'completed', v_health, now())
    on conflict (owner_id, maintenance_key, scheduled_for)
    do update set status = 'completed', details = excluded.details, completed_at = excluded.completed_at;

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('ok', true, 'processed', v_processed, 'checked_at', now(),
    'memory_jobs', 'left_for_model_backed_edge_worker');
end;
$$;

revoke all on function public.ultron_process_cloud_jobs() from public, anon, authenticated;
