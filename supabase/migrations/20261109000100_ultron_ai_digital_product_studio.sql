create table if not exists public.ultron_product_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New digital product',
  user_request text not null default '',
  selected_topic text,
  status text not null default 'queued' check (status in ('queued','identifying','researching','synthesizing','creating','validating','packaging','completed','paused','waiting_for_provider','partial','failed','cancelled')),
  active_stage text not null default 'identification',
  progress integer not null default 0 check (progress between 0 and 100),
  research_target integer not null default 200 check (research_target in (50,100,200,500)),
  source_counts jsonb not null default '{"discovered":0,"opened":0,"analyzed":0,"rejected":0,"failed":0}'::jsonb,
  configuration jsonb not null default '{}'::jsonb,
  opportunity_brief jsonb not null default '{}'::jsonb,
  synthesis_summary jsonb not null default '{}'::jsonb,
  draft_markdown text not null default '',
  preview_html text not null default '',
  artifact_id uuid references public.ultron_artifacts(id) on delete set null,
  source_job_id uuid references public.ultron_jobs(id) on delete set null,
  error_message text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_id,idempotency_key)
);
create index if not exists ultron_product_projects_owner_updated_idx on public.ultron_product_projects(owner_id,updated_at desc);
create index if not exists ultron_product_projects_owner_status_idx on public.ultron_product_projects(owner_id,status);

create table if not exists public.ultron_product_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.ultron_product_projects(id) on delete cascade,
  canonical_url text not null,
  url_hash text not null,
  title text not null default '',
  domain text not null default '',
  source_type text not null default 'web',
  publisher text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  fetch_status text not null default 'discovered' check (fetch_status in ('discovered','opened','analyzed','rejected','failed')),
  relevance_score numeric(5,4),
  content_hash text,
  extraction_summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  unique(project_id,url_hash)
);
create index if not exists ultron_product_sources_project_idx on public.ultron_product_sources(project_id,relevance_score desc);

create table if not exists public.ultron_product_events (
  sequence bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.ultron_product_projects(id) on delete cascade,
  stage text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ultron_product_events_cursor_idx on public.ultron_product_events(project_id,sequence);

create table if not exists public.ultron_product_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.ultron_product_projects(id) on delete cascade,
  title text not null,
  format text not null default 'markdown',
  status text not null default 'draft' check (status in ('draft','final','archived')),
  version integer not null default 1,
  storage_path text,
  mime_type text,
  byte_size bigint not null default 0,
  checksum_sha256 text,
  validation_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(project_id,title,version)
);
create index if not exists ultron_product_documents_project_idx on public.ultron_product_documents(project_id,created_at desc);

alter table public.ultron_product_projects enable row level security;
alter table public.ultron_product_sources enable row level security;
alter table public.ultron_product_events enable row level security;
alter table public.ultron_product_documents enable row level security;

drop policy if exists ultron_product_projects_owner_all on public.ultron_product_projects;
create policy ultron_product_projects_owner_all on public.ultron_product_projects for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id = (select auth.uid())));
drop policy if exists ultron_product_sources_owner_all on public.ultron_product_sources;
create policy ultron_product_sources_owner_all on public.ultron_product_sources for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id = (select auth.uid())));
drop policy if exists ultron_product_events_owner_select on public.ultron_product_events;
create policy ultron_product_events_owner_select on public.ultron_product_events for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists ultron_product_documents_owner_all on public.ultron_product_documents;
create policy ultron_product_documents_owner_all on public.ultron_product_documents for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id = (select auth.uid())));

grant select,insert,update,delete on public.ultron_product_projects to authenticated;
grant select,insert,update,delete on public.ultron_product_sources to authenticated;
grant select on public.ultron_product_events to authenticated;
grant select,insert,update,delete on public.ultron_product_documents to authenticated;
grant usage,select on sequence public.ultron_product_events_sequence_seq to authenticated;

alter publication supabase_realtime add table public.ultron_product_projects;
alter publication supabase_realtime add table public.ultron_product_events;
