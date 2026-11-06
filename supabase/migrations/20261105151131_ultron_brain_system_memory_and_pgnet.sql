create extension if not exists pg_net with schema extensions;

create or replace function public.ultron_match_local_memories_system(
  p_owner_id uuid,
  query_embedding extensions.vector(96),
  match_count integer default 8,
  min_similarity double precision default 0.08
)
returns table(
  id uuid,
  memory_type text,
  content text,
  summary text,
  confidence numeric,
  source text,
  source_ref text,
  metadata jsonb,
  similarity double precision,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id, m.memory_type, m.content, m.summary, m.confidence, m.source, m.source_ref, m.metadata,
    1 - (m.local_embedding OPERATOR(extensions.<=>) query_embedding) as similarity,
    m.updated_at
  from public.ultron_memory_items m
  where m.owner_id = p_owner_id
    and m.archived_at is null
    and m.local_embedding is not null
    and 1 - (m.local_embedding OPERATOR(extensions.<=>) query_embedding) >= greatest(0, least(1, min_similarity))
  order by m.local_embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(1, least(20, match_count));
$$;
revoke all on function public.ultron_match_local_memories_system(uuid,extensions.vector,integer,double precision) from public, anon, authenticated;
grant execute on function public.ultron_match_local_memories_system(uuid,extensions.vector,integer,double precision) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'ultron-brain-supervisor';
select cron.schedule(
  'ultron-brain-supervisor',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://vshoxrtrfleptqxkrmtc.supabase.co/functions/v1/ultron-brain',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ultron-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ultron_brain_cron_secret')
      ),
      body := jsonb_build_object('action', 'worker', 'limit', 2),
      timeout_milliseconds := 65000
    );
  $job$
);
