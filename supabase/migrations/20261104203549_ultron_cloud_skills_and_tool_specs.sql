create table if not exists public.ultron_skills (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  skill_key text not null check (skill_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  version text not null check (version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
  title text not null check (char_length(title) between 1 and 140),
  description text not null default '' check (char_length(description) <= 800),
  triggers text[] not null default '{}',
  instructions text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null default 0.5 check (confidence between 0 and 1),
  verified_runs integer not null default 0 check (verified_runs >= 0),
  status text not null default 'active' check (status in ('provisional','active','archived')),
  source text not null default 'agent_created' check (source in ('agent_created','distilled','owner_imported')),
  usage_count bigint not null default 0 check (usage_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, skill_key, version)
);
create index if not exists ultron_skills_owner_status_idx on public.ultron_skills(owner_id,status,skill_key);
create index if not exists ultron_skills_owner_updated_idx on public.ultron_skills(owner_id,updated_at desc);
alter table public.ultron_skills enable row level security;
drop policy if exists ultron_skills_owner_all on public.ultron_skills;
create policy ultron_skills_owner_all on public.ultron_skills for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
grant select,insert,update,delete on public.ultron_skills to authenticated;
revoke all on public.ultron_skills from anon;
drop trigger if exists ultron_skills_updated_at on public.ultron_skills;
create trigger ultron_skills_updated_at before update on public.ultron_skills for each row execute function public.ultron_set_updated_at();

create table if not exists public.ultron_tool_specs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tool_key text not null check (tool_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  version text not null check (version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
  title text not null check (char_length(title) between 1 and 140),
  description text not null check (char_length(description) between 1 and 1200),
  input_schema jsonb not null default '{"type":"object"}'::jsonb check (jsonb_typeof(input_schema)='object' and input_schema->>'type'='object'),
  workflow jsonb not null check (jsonb_typeof(workflow)='array' and jsonb_array_length(workflow) between 1 and 30),
  workflow_sha256 text not null check (workflow_sha256 ~ '^[a-f0-9]{64}$'),
  lifecycle_state text not null default 'active' check (lifecycle_state in ('active','disabled','archived')),
  created_by text not null default 'ultron' check (created_by in ('ultron','owner')),
  run_count bigint not null default 0 check (run_count >= 0),
  last_run_at timestamptz,
  last_run_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,tool_key,version)
);
create index if not exists ultron_tool_specs_owner_state_idx on public.ultron_tool_specs(owner_id,lifecycle_state,tool_key);
create index if not exists ultron_tool_specs_owner_updated_idx on public.ultron_tool_specs(owner_id,updated_at desc);
alter table public.ultron_tool_specs enable row level security;
drop policy if exists ultron_tool_specs_owner_all on public.ultron_tool_specs;
create policy ultron_tool_specs_owner_all on public.ultron_tool_specs for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
grant select,insert,update,delete on public.ultron_tool_specs to authenticated;
revoke all on public.ultron_tool_specs from anon;
drop trigger if exists ultron_tool_specs_updated_at on public.ultron_tool_specs;
create trigger ultron_tool_specs_updated_at before update on public.ultron_tool_specs for each row execute function public.ultron_set_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ultron_skills') then alter publication supabase_realtime add table public.ultron_skills; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ultron_tool_specs') then alter publication supabase_realtime add table public.ultron_tool_specs; end if;
end $$;
