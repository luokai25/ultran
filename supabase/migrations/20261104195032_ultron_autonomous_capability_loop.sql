-- ULTRON autonomous capability loop: persistent runs, immutable tool versions, proposals and audit.
create table public.ultron_agent_runs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 goal text not null check(char_length(goal) between 1 and 8000), status text not null default 'queued' check(status in ('queued','running','waiting_approval','paused','completed','failed','cancelled')),
 phase text not null default 'planning', iteration integer not null default 0 check(iteration>=0), iteration_limit integer not null default 40 check(iteration_limit between 1 and 1000),
 token_budget integer check(token_budget is null or token_budget>=0), tokens_used integer not null default 0 check(tokens_used>=0),
 checkpoint jsonb not null default '{}'::jsonb, result jsonb, error_message text, heartbeat_at timestamptz, started_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.ultron_generated_tools (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 tool_key text not null check(tool_key ~ '^[a-z][a-z0-9_]{1,47}$'), version text not null check(version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'),
 description text not null check(char_length(description) between 1 and 500), input_schema jsonb not null check(jsonb_typeof(input_schema)='object' and input_schema->>'type'='object'),
 source_language text not null default 'python' check(source_language in ('python','typescript','javascript')),
 source_code text not null check(octet_length(source_code) between 1 and 32768), source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 lifecycle_state text not null default 'draft' check(lifecycle_state in ('draft','pending_approval','approved','active','rejected','disabled','failed')),
 review_report jsonb not null default '{}'::jsonb, worker_ref text, approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,tool_key,version), unique(id,owner_id)
);
create table public.ultron_capability_proposals (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, agent_run_id uuid,
 proposal_kind text not null check(proposal_kind in ('tool_activation','edge_function','database_migration','connector','policy_change','runtime_upgrade')),
 title text not null check(char_length(title) between 1 and 180), description text not null check(char_length(description) between 1 and 4000),
 artifact jsonb not null default '{}'::jsonb, artifact_sha256 text check(artifact_sha256 is null or artifact_sha256 ~ '^[a-f0-9]{64}$'),
 risk_level text not null default 'medium' check(risk_level in ('low','medium','high','critical')),
 status text not null default 'pending' check(status in ('pending','approved','rejected','applied','failed','cancelled')),
 decision_note text, approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz, applied_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(agent_run_id,owner_id) references public.ultron_agent_runs(id,owner_id) on delete set null (agent_run_id), unique(id,owner_id)
);
create table public.ultron_capability_events (
 id bigint generated always as identity primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 agent_run_id uuid, tool_id uuid, proposal_id uuid, event_type text not null check(char_length(event_type) between 1 and 80),
 details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 foreign key(agent_run_id,owner_id) references public.ultron_agent_runs(id,owner_id) on delete set null (agent_run_id),
 foreign key(tool_id,owner_id) references public.ultron_generated_tools(id,owner_id) on delete set null (tool_id),
 foreign key(proposal_id,owner_id) references public.ultron_capability_proposals(id,owner_id) on delete set null (proposal_id)
);
create index ultron_agent_runs_owner_status_idx on public.ultron_agent_runs(owner_id,status,updated_at desc);
create index ultron_generated_tools_owner_state_idx on public.ultron_generated_tools(owner_id,lifecycle_state,tool_key);
create index ultron_capability_proposals_owner_status_idx on public.ultron_capability_proposals(owner_id,status,created_at desc);
create index ultron_capability_events_owner_created_idx on public.ultron_capability_events(owner_id,created_at desc);
create trigger ultron_agent_runs_updated_at before update on public.ultron_agent_runs for each row execute function public.ultron_set_updated_at();
create trigger ultron_generated_tools_updated_at before update on public.ultron_generated_tools for each row execute function public.ultron_set_updated_at();
create trigger ultron_capability_proposals_updated_at before update on public.ultron_capability_proposals for each row execute function public.ultron_set_updated_at();
create or replace function public.ultron_guard_generated_tool_update() returns trigger language plpgsql set search_path='' as $$
begin
 if old.lifecycle_state<>'draft' and (new.tool_key is distinct from old.tool_key or new.version is distinct from old.version or new.description is distinct from old.description or new.input_schema is distinct from old.input_schema or new.source_language is distinct from old.source_language or new.source_code is distinct from old.source_code or new.source_sha256 is distinct from old.source_sha256) then raise exception 'Submitted tool versions are immutable; create a new version'; end if;
 if not ((old.lifecycle_state='draft' and new.lifecycle_state='pending_approval') or (old.lifecycle_state='pending_approval' and new.lifecycle_state in ('approved','rejected')) or (old.lifecycle_state in ('approved','active') and new.lifecycle_state='disabled') or old.lifecycle_state=new.lifecycle_state) then raise exception 'Invalid generated tool lifecycle transition: % -> %',old.lifecycle_state,new.lifecycle_state; end if;
 if new.lifecycle_state='active' and old.lifecycle_state<>'active' then raise exception 'Only a trusted isolated worker may activate generated tools'; end if;
 return new;
end; $$;
create trigger ultron_generated_tools_guard_update before update on public.ultron_generated_tools for each row execute function public.ultron_guard_generated_tool_update();
alter table public.ultron_agent_runs enable row level security;
alter table public.ultron_generated_tools enable row level security;
alter table public.ultron_capability_proposals enable row level security;
alter table public.ultron_capability_events enable row level security;
grant select,insert,update on public.ultron_agent_runs to authenticated;
grant select,insert,update on public.ultron_generated_tools to authenticated;
grant select,insert,update on public.ultron_capability_proposals to authenticated;
grant select,insert on public.ultron_capability_events to authenticated;
create policy ultron_agent_runs_owner_all on public.ultron_agent_runs for all to authenticated using(auth.uid() is not null and owner_id=(select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid()))) with check(auth.uid() is not null and owner_id=(select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid())));
create policy ultron_generated_tools_owner_all on public.ultron_generated_tools for all to authenticated using(auth.uid() is not null and owner_id=(select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid()))) with check(auth.uid() is not null and owner_id=(select auth.uid()) and lifecycle_state<>'active' and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid())));
create policy ultron_capability_proposals_owner_all on public.ultron_capability_proposals for all to authenticated using(auth.uid() is not null and owner_id=(select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid()))) with check(auth.uid() is not null and owner_id=(select auth.uid()) and status in ('pending','approved','rejected','cancelled') and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid())));
create policy ultron_capability_events_owner_read on public.ultron_capability_events for select to authenticated using(auth.uid() is not null and owner_id=(select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid())));
create policy ultron_capability_events_owner_insert on public.ultron_capability_events for insert to authenticated with check(auth.uid() is not null and owner_id=(select auth.uid()) and exists(select 1 from public.ultron_instance i where i.owner_id=(select auth.uid())));
revoke all on table public.ultron_agent_runs,public.ultron_generated_tools,public.ultron_capability_proposals,public.ultron_capability_events from anon;
alter default privileges in schema public revoke all on tables from anon;
do $$ declare t text; begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then foreach t in array array['ultron_agent_runs','ultron_generated_tools','ultron_capability_proposals','ultron_capability_events'] loop if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if; end loop; end if; end; $$;
