-- Cover foreign keys reported by Supabase's performance advisor.
-- These indexes keep owner-scoped joins and deletes efficient as ULTRON grows.
create index if not exists ultron_artifacts_source_run_id_idx
  on public.ultron_artifacts(source_run_id);

create index if not exists ultron_state_snapshots_last_event_id_idx
  on public.ultron_state_snapshots(last_event_id);

create index if not exists ultron_tool_evaluations_tool_spec_id_idx
  on public.ultron_tool_evaluations(tool_spec_id);

create index if not exists ultron_tool_evaluations_generated_tool_id_idx
  on public.ultron_tool_evaluations(generated_tool_id);

create index if not exists ultron_tool_evaluations_skill_id_idx
  on public.ultron_tool_evaluations(skill_id);
