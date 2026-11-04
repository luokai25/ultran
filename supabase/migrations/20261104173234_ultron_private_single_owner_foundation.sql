create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Provision this singleton only after the owner's Auth account exists.
create table public.ultron_instance (
  id boolean primary key default true check (id),
  owner_id uuid not null unique references auth.users(id) on delete restrict,
  display_name text not null default 'ULTRON',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ultron_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  summary text,
  status text not null default 'active' check (status in ('active','archived','deleted')),
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.ultron_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('system','user','assistant','tool')),
  content text not null default '',
  parts jsonb not null default '[]'::jsonb,
  model_id text,
  tool_name text,
  sequence_no bigint generated always as identity,
  status text not null default 'complete' check (status in ('streaming','complete','failed','cancelled')),
  token_count integer check (token_count is null or token_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (conversation_id, owner_id)
    references public.ultron_conversations(id, owner_id) on delete cascade
);

create table public.ultron_memory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  memory_type text not null check (memory_type in ('identity','preference','fact','episodic','semantic','goal','decision','procedure','relationship')),
  content text not null,
  summary text,
  importance smallint not null default 3 check (importance between 1 and 5),
  confidence numeric(4,3) not null default 0.800 check (confidence between 0 and 1),
  source text,
  source_ref text,
  embedding extensions.vector(384),
  embedding_model text,
  metadata jsonb not null default '{}'::jsonb,
  last_accessed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.ultron_memory_relations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_memory_id uuid not null,
  target_memory_id uuid not null,
  relation_type text not null,
  weight numeric(5,4) not null default 1.0 check (weight >= 0 and weight <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (source_memory_id <> target_memory_id),
  unique (owner_id, source_memory_id, target_memory_id, relation_type),
  foreign key (source_memory_id, owner_id)
    references public.ultron_memory_items(id, owner_id) on delete cascade,
  foreign key (target_memory_id, owner_id)
    references public.ultron_memory_items(id, owner_id) on delete cascade
);

create table public.ultron_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  mime_type text,
  storage_path text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum_sha256 text,
  processing_status text not null default 'pending' check (processing_status in ('pending','processing','ready','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.ultron_document_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  embedding extensions.vector(384),
  embedding_model text,
  token_count integer check (token_count is null or token_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  foreign key (document_id, owner_id)
    references public.ultron_documents(id, owner_id) on delete cascade
);

create table public.ultron_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text,
  task_type text not null default 'general',
  status text not null default 'queued' check (status in ('queued','running','waiting_approval','completed','failed','cancelled')),
  priority smallint not null default 3 check (priority between 1 and 5),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.ultron_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tool_key text not null,
  access_mode text not null default 'deny' check (access_mode in ('deny','ask','allow')),
  scopes jsonb not null default '[]'::jsonb,
  require_confirmation boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, tool_key)
);

create table public.ultron_tool_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid,
  tool_key text not null,
  status text not null default 'pending' check (status in ('pending','awaiting_approval','running','succeeded','failed','denied','cancelled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error_message text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (task_id, owner_id)
    references public.ultron_tasks(id, owner_id) on delete set null
);

create table public.ultron_model_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null,
  model_id text not null,
  display_name text not null,
  runtime_kind text not null check (runtime_kind in ('local','remote','api')),
  endpoint_url text,
  credential_ref text,
  capabilities jsonb not null default '[]'::jsonb,
  context_window integer check (context_window is null or context_window > 0),
  max_output_tokens integer check (max_output_tokens is null or max_output_tokens > 0),
  is_enabled boolean not null default true,
  is_default boolean not null default false,
  priority smallint not null default 3 check (priority between 1 and 5),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider, model_id)
);

create table public.ultron_settings (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, setting_key)
);

create table public.ultron_device_sync (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_key text not null,
  device_name text,
  platform text,
  last_sync_at timestamptz,
  sync_cursor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, device_key)
);

create index ultron_messages_conversation_sequence_idx on public.ultron_messages(owner_id, conversation_id, sequence_no);
create index ultron_conversations_recent_idx on public.ultron_conversations(owner_id, last_message_at desc nulls last);
create index ultron_memory_items_type_idx on public.ultron_memory_items(owner_id, memory_type, importance desc) where archived_at is null;
create index ultron_memory_items_search_idx on public.ultron_memory_items using gin (to_tsvector('simple', coalesce(content,'')));
create index ultron_memory_relations_source_idx on public.ultron_memory_relations(owner_id, source_memory_id);
create index ultron_memory_relations_target_idx on public.ultron_memory_relations(owner_id, target_memory_id);
create index ultron_document_chunks_document_idx on public.ultron_document_chunks(owner_id, document_id, chunk_index);
create index ultron_tasks_queue_idx on public.ultron_tasks(owner_id, status, priority desc, created_at);
create index ultron_tool_runs_status_idx on public.ultron_tool_runs(owner_id, status, requested_at desc);

create or replace function public.ultron_set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ultron_instance_updated_at before update on public.ultron_instance for each row execute function public.ultron_set_updated_at();
create trigger ultron_conversations_updated_at before update on public.ultron_conversations for each row execute function public.ultron_set_updated_at();
create trigger ultron_memory_items_updated_at before update on public.ultron_memory_items for each row execute function public.ultron_set_updated_at();
create trigger ultron_documents_updated_at before update on public.ultron_documents for each row execute function public.ultron_set_updated_at();
create trigger ultron_tasks_updated_at before update on public.ultron_tasks for each row execute function public.ultron_set_updated_at();
create trigger ultron_tool_permissions_updated_at before update on public.ultron_tool_permissions for each row execute function public.ultron_set_updated_at();
create trigger ultron_model_profiles_updated_at before update on public.ultron_model_profiles for each row execute function public.ultron_set_updated_at();
create trigger ultron_device_sync_updated_at before update on public.ultron_device_sync for each row execute function public.ultron_set_updated_at();

alter table public.ultron_instance enable row level security;
alter table public.ultron_conversations enable row level security;
alter table public.ultron_messages enable row level security;
alter table public.ultron_memory_items enable row level security;
alter table public.ultron_memory_relations enable row level security;
alter table public.ultron_documents enable row level security;
alter table public.ultron_document_chunks enable row level security;
alter table public.ultron_tasks enable row level security;
alter table public.ultron_tool_permissions enable row level security;
alter table public.ultron_tool_runs enable row level security;
alter table public.ultron_model_profiles enable row level security;
alter table public.ultron_settings enable row level security;
alter table public.ultron_device_sync enable row level security;

grant select, update on public.ultron_instance to authenticated;
grant select, insert, update, delete on
  public.ultron_conversations, public.ultron_messages, public.ultron_memory_items,
  public.ultron_memory_relations, public.ultron_documents, public.ultron_document_chunks,
  public.ultron_tasks, public.ultron_tool_permissions, public.ultron_tool_runs,
  public.ultron_model_profiles, public.ultron_settings, public.ultron_device_sync
to authenticated;

create policy ultron_instance_owner_select on public.ultron_instance
for select to authenticated using (auth.uid() is not null and owner_id = (select auth.uid()));
create policy ultron_instance_owner_update on public.ultron_instance
for update to authenticated using (auth.uid() is not null and owner_id = (select auth.uid()))
with check (auth.uid() is not null and owner_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'ultron_conversations','ultron_messages','ultron_memory_items','ultron_memory_relations',
    'ultron_documents','ultron_document_chunks','ultron_tasks','ultron_tool_permissions',
    'ultron_tool_runs','ultron_model_profiles','ultron_settings','ultron_device_sync'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (
        auth.uid() is not null
        and owner_id = (select auth.uid())
        and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid()))
      ) with check (
        auth.uid() is not null
        and owner_id = (select auth.uid())
        and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid()))
      )',
      t || '_single_owner_all', t
    );
  end loop;
end;
$$;

insert into storage.buckets (id, name, public)
values ('ultron-private', 'ultron-private', false)
on conflict (id) do update set public = false;

create policy ultron_storage_select_owner on storage.objects for select to authenticated using (
  bucket_id = 'ultron-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid()))
);
create policy ultron_storage_insert_owner on storage.objects for insert to authenticated with check (
  bucket_id = 'ultron-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid()))
);
create policy ultron_storage_update_owner on storage.objects for update to authenticated using (
  bucket_id = 'ultron-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid()))
) with check (
  bucket_id = 'ultron-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid()))
);
create policy ultron_storage_delete_owner on storage.objects for delete to authenticated using (
  bucket_id = 'ultron-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.ultron_instance i where i.owner_id = (select auth.uid()))
);

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['ultron_conversations','ultron_messages','ultron_tasks','ultron_tool_runs','ultron_memory_items'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
