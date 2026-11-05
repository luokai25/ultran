create or replace function public.ultron_guard_generated_tool_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lifecycle_state <> 'draft' and (
    new.tool_key is distinct from old.tool_key or
    new.version is distinct from old.version or
    new.description is distinct from old.description or
    new.input_schema is distinct from old.input_schema or
    new.source_language is distinct from old.source_language or
    new.source_code is distinct from old.source_code or
    new.source_sha256 is distinct from old.source_sha256
  ) then
    raise exception 'Submitted tool versions are immutable; create a new version';
  end if;
  if not (
    (old.lifecycle_state = 'draft' and new.lifecycle_state = 'pending_approval') or
    (old.lifecycle_state = 'pending_approval' and new.lifecycle_state in ('approved','rejected')) or
    (old.lifecycle_state in ('approved','active') and new.lifecycle_state = 'disabled') or
    old.lifecycle_state = new.lifecycle_state or
    current_setting('ultron.recovery_mode', true) = 'on'
  ) then
    raise exception 'Invalid generated tool lifecycle transition: % -> %', old.lifecycle_state, new.lifecycle_state;
  end if;
  if new.lifecycle_state = 'active' and old.lifecycle_state <> 'active'
     and current_setting('ultron.recovery_mode', true) is distinct from 'on' then
    raise exception 'Only a trusted isolated worker may activate generated tools';
  end if;
  return new;
end;
$$;

create or replace function public.ultron_restore_generated_tool_lifecycle(
  p_owner_id uuid,
  p_tool_id uuid,
  p_lifecycle_state text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lifecycle_state not in ('draft','pending_approval','approved','active','rejected','disabled','failed') then
    raise exception 'invalid_recovery_lifecycle_state';
  end if;
  perform set_config('ultron.recovery_mode', 'on', true);
  update public.ultron_generated_tools
     set lifecycle_state = p_lifecycle_state
   where owner_id = p_owner_id and id = p_tool_id;
  return found;
end;
$$;
revoke all on function public.ultron_restore_generated_tool_lifecycle(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.ultron_restore_generated_tool_lifecycle(uuid,uuid,text) to service_role;
