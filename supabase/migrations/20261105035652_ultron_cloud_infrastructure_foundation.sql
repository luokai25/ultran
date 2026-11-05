-- ULTRON cloud infrastructure: connector metadata, artifact metadata, state replication, evaluation history.
-- OAuth/API credentials are referenced by Vault UUID only; plaintext secrets are never stored here.

create table if not exists public.ultron_connector_connections (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 provider_key text not null check(provider_key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
 connection_key text not null check(length(connection_key) between 1 and 120),
 display_name text not null check(length(display_name) between 1 and 160),
 status text not null default 'pending' check(status in ('pending','connected','refresh_required','revoked','error')),
 vault_secret_id uuid, scopes text[] not null default '{}',
 external_account_id text, external_account_label text, access_expires_at timestamptz,
 last_verified_at timestamptz, last_error text,
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,provider_key,connection_key)
);
create index if not exists ultron_connector_connections_owner_status_idx on public.ultron_connector_connections(owner_id,status,provider_key);
alter table public.ultron_connector_connections enable row level security;
create policy ultron_connector_connections_owner_all on public.ultron_connector_connections for all to authenticated
 using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
grant select,insert,update,delete on public.ultron_connector_connections to authenticated;

create table if not exists public.ultron_artifacts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check(length(name) between 1 and 240), description text,
 artifact_type text not null default 'file' check(artifact_type in ('pdf','report','archive','image','document','code','data','file')),
 mime_type text not null default 'application/octet-stream',
 bucket_id text not null default 'ultron-private', storage_path text not null,
 byte_size bigint not null default 0 check(byte_size>=0),
 checksum_sha256 text check(checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
 source_job_id uuid references public.ultron_jobs(id) on delete set null,
 source_run_id uuid references public.ultron_agent_runs(id) on delete set null,
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(bucket_id,storage_path)
);
create index if not exists ultron_artifacts_owner_created_idx on public.ultron_artifacts(owner_id,created_at desc);
alter table public.ultron_artifacts enable row level security;
create policy ultron_artifacts_owner_all on public.ultron_artifacts for all to authenticated
 using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
grant select,insert,update,delete on public.ultron_artifacts to authenticated;

create table if not exists public.ultron_state_events (
 id bigint generated always as identity primary key,
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 device_id text not null check(length(device_id) between 1 and 120),
 device_seq bigint not null check(device_seq>0),
 entity_type text not null check(entity_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
 entity_id text not null check(length(entity_id) between 1 and 200),
 base_version bigint not null default 0 check(base_version>=0),
 entity_version bigint not null check(entity_version>0),
 operation text not null default 'upsert' check(operation in ('upsert','delete','merge')),
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
 payload_sha256 text check(payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
 occurred_at timestamptz not null default now(), received_at timestamptz not null default now(),
 unique(owner_id,device_id,device_seq), unique(owner_id,entity_type,entity_id,entity_version)
);
create index if not exists ultron_state_events_owner_cursor_idx on public.ultron_state_events(owner_id,id);
create index if not exists ultron_state_events_entity_version_idx on public.ultron_state_events(owner_id,entity_type,entity_id,entity_version desc);
alter table public.ultron_state_events enable row level security;
create policy ultron_state_events_owner_select on public.ultron_state_events for select to authenticated using((select auth.uid())=owner_id);
create policy ultron_state_events_owner_insert on public.ultron_state_events for insert to authenticated with check((select auth.uid())=owner_id);
grant select,insert on public.ultron_state_events to authenticated;
revoke update,delete on public.ultron_state_events from authenticated;

create table if not exists public.ultron_state_snapshots (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 device_id text not null check(length(device_id) between 1 and 120),
 entity_type text not null check(entity_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
 entity_id text not null check(length(entity_id) between 1 and 200),
 entity_version bigint not null check(entity_version>0),
 state jsonb not null check(jsonb_typeof(state)='object'),
 state_sha256 text check(state_sha256 is null or state_sha256 ~ '^[a-f0-9]{64}$'),
 last_event_id bigint references public.ultron_state_events(id) on delete set null,
 updated_at timestamptz not null default now(), unique(owner_id,entity_type,entity_id)
);
create index if not exists ultron_state_snapshots_owner_updated_idx on public.ultron_state_snapshots(owner_id,updated_at desc);
alter table public.ultron_state_snapshots enable row level security;
create policy ultron_state_snapshots_owner_all on public.ultron_state_snapshots for all to authenticated
 using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
grant select,insert,update,delete on public.ultron_state_snapshots to authenticated;

create table if not exists public.ultron_tool_evaluations (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 tool_spec_id uuid references public.ultron_tool_specs(id) on delete set null,
 generated_tool_id uuid references public.ultron_generated_tools(id) on delete set null,
 skill_id uuid references public.ultron_skills(id) on delete set null,
 artifact_sha256 text not null check(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 evaluator_version text not null default 'ultron-eval-v1',
 status text not null default 'queued' check(status in ('queued','running','passed','failed','needs_review','cancelled')),
 score numeric(5,4) check(score is null or score between 0 and 1),
 test_count integer not null default 0 check(test_count>=0),
 passed_count integer not null default 0 check(passed_count>=0),
 failed_count integer not null default 0 check(failed_count>=0),
 report jsonb not null default '{}'::jsonb check(jsonb_typeof(report)='object'),
 started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(),
 check(passed_count+failed_count<=test_count)
);
create index if not exists ultron_tool_evaluations_owner_created_idx on public.ultron_tool_evaluations(owner_id,created_at desc);
alter table public.ultron_tool_evaluations enable row level security;
create policy ultron_tool_evaluations_owner_all on public.ultron_tool_evaluations for all to authenticated
 using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
grant select,insert,update,delete on public.ultron_tool_evaluations to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('ultron-private','ultron-private',false,52428800)
on conflict(id) do update set public=false,file_size_limit=52428800;
create policy ultron_private_owner_read on storage.objects for select to authenticated
 using(bucket_id='ultron-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy ultron_private_owner_insert on storage.objects for insert to authenticated
 with check(bucket_id='ultron-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy ultron_private_owner_update on storage.objects for update to authenticated
 using(bucket_id='ultron-private' and (storage.foldername(name))[1]=(select auth.uid())::text)
 with check(bucket_id='ultron-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy ultron_private_owner_delete on storage.objects for delete to authenticated
 using(bucket_id='ultron-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.ultron_state_events;
  alter publication supabase_realtime add table public.ultron_state_snapshots;
  alter publication supabase_realtime add table public.ultron_artifacts;
 end if;
end $$;
