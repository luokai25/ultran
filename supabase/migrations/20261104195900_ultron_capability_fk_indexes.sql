-- Cover all new composite and approval foreign keys flagged by Supabase Performance Advisors.
create index if not exists ultron_capability_events_agent_run_owner_fk_idx on public.ultron_capability_events(agent_run_id, owner_id) where agent_run_id is not null;
create index if not exists ultron_capability_events_tool_owner_fk_idx on public.ultron_capability_events(tool_id, owner_id) where tool_id is not null;
create index if not exists ultron_capability_events_proposal_owner_fk_idx on public.ultron_capability_events(proposal_id, owner_id) where proposal_id is not null;
create index if not exists ultron_capability_proposals_agent_run_owner_fk_idx on public.ultron_capability_proposals(agent_run_id, owner_id) where agent_run_id is not null;
create index if not exists ultron_capability_proposals_approved_by_fk_idx on public.ultron_capability_proposals(approved_by) where approved_by is not null;
create index if not exists ultron_generated_tools_approved_by_fk_idx on public.ultron_generated_tools(approved_by) where approved_by is not null;
