alter table public.ultron_memory_items add column if not exists local_embedding extensions.vector(96);
create index if not exists ultron_memory_items_local_embedding_hnsw
  on public.ultron_memory_items using hnsw (local_embedding extensions.vector_cosine_ops)
  where archived_at is null and local_embedding is not null;

create or replace function public.ultron_match_local_memories(
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
security invoker
set search_path = public, extensions
as $$
  select
    m.id,
    m.memory_type,
    m.content,
    m.summary,
    m.confidence,
    m.source,
    m.source_ref,
    m.metadata,
    1 - (m.local_embedding OPERATOR(extensions.<=>) query_embedding) as similarity,
    m.updated_at
  from public.ultron_memory_items m
  where m.owner_id = auth.uid()
    and m.archived_at is null
    and m.local_embedding is not null
    and 1 - (m.local_embedding OPERATOR(extensions.<=>) query_embedding) >= greatest(0, least(1, min_similarity))
  order by m.local_embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(1, least(20, match_count));
$$;
revoke all on function public.ultron_match_local_memories(extensions.vector,integer,double precision) from public;
revoke all on function public.ultron_match_local_memories(extensions.vector,integer,double precision) from anon;
grant execute on function public.ultron_match_local_memories(extensions.vector,integer,double precision) to authenticated;
