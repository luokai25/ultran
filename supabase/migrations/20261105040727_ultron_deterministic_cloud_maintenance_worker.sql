-- Cloud maintenance worker: deterministic health checks only.
-- Semantic memory consolidation remains disabled until a cloud model is configured.
create or replace function public.ultron_process_cloud_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_job record; v_processed integer := 0; v_health jsonb;
begin
 select owner_id into v_owner from public.ultron_instance where id=true limit 1;
 if v_owner is null then return jsonb_build_object('ok',false,'reason','instance_not_configured'); end if;
 for v_job in select id,job_type from public.ultron_jobs where owner_id=v_owner and status in ('queued','retry_wait') and run_after<=now() and job_type in ('maintenance.health_check','memory.consolidate') order by priority desc,created_at asc for update skip locked limit 5 loop
  update public.ultron_jobs set status='running',attempts=attempts+1,lock_token=gen_random_uuid(),locked_at=now(),heartbeat_at=now(),lease_expires_at=now()+interval '90 seconds',updated_at=now() where id=v_job.id and owner_id=v_owner;
  if v_job.job_type='maintenance.health_check' then
   select jsonb_build_object('checked_at',now(),'database','reachable','tables',jsonb_build_object(
    'conversations',(select count(*) from public.ultron_conversations where owner_id=v_owner),
    'messages',(select count(*) from public.ultron_messages where owner_id=v_owner),
    'memories',(select count(*) from public.ultron_memory_items where owner_id=v_owner),
    'queued_jobs',(select count(*) from public.ultron_jobs where owner_id=v_owner and status in ('queued','retry_wait')),
    'running_jobs',(select count(*) from public.ultron_jobs where owner_id=v_owner and status='running'),
    'artifacts',(select count(*) from public.ultron_artifacts where owner_id=v_owner),
    'connectors',(select count(*) from public.ultron_connector_connections where owner_id=v_owner)),
    'storage_bucket_present',exists(select 1 from storage.buckets where id='ultron-private'),'worker','maintenance-v1') into v_health;
   update public.ultron_jobs set status='completed',result=v_health,error_message=null,completed_at=now(),lock_token=null,locked_at=null,heartbeat_at=null,lease_expires_at=null,updated_at=now() where id=v_job.id and owner_id=v_owner and status='running';
   insert into public.ultron_maintenance_runs(owner_id,maintenance_key,scheduled_for,status,details,completed_at) values(v_owner,'health_check',date_trunc('minute',now()),'completed',v_health,now())
   on conflict(owner_id,maintenance_key,scheduled_for) do update set status='completed',details=excluded.details,completed_at=excluded.completed_at;
  elsif v_job.job_type='memory.consolidate' then
   update public.ultron_jobs set status='failed',error_message='LLM memory consolidation is not enabled yet; memory data was left unchanged.',completed_at=now(),lock_token=null,locked_at=null,heartbeat_at=null,lease_expires_at=null,updated_at=now() where id=v_job.id and owner_id=v_owner and status='running';
   insert into public.ultron_maintenance_runs(owner_id,maintenance_key,scheduled_for,status,details,completed_at) values(v_owner,'memory_consolidation_skipped',date_trunc('day',now()),'failed',jsonb_build_object('reason','no_cloud_model_configured','memory_mutated',false),now())
   on conflict(owner_id,maintenance_key,scheduled_for) do nothing;
  end if;
  v_processed:=v_processed+1;
 end loop;
 return jsonb_build_object('ok',true,'processed',v_processed,'checked_at',now());
end; $$;
revoke all on function public.ultron_process_cloud_jobs() from public,anon,authenticated;
do $$ declare v_job_id bigint; begin
 select jobid into v_job_id from cron.job where jobname='ultron-maintenance-queue' limit 1;
 if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
 perform cron.schedule('ultron-maintenance-queue','*/5 * * * *','select public.ultron_enqueue_maintenance(); select public.ultron_process_cloud_jobs();');
end $$;