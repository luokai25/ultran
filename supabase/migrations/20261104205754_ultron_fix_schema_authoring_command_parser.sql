create or replace function public.ultron_apply_schema_change(statement text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_command text;
  v_hash text;
begin
  if v_owner is null or not exists (select 1 from public.ultron_instance where owner_id = v_owner) then
    raise insufficient_privilege using message = 'ULTRON owner session required';
  end if;
  if statement is null or length(statement) < 8 or length(statement) > 50000 then
    raise invalid_parameter_value using message = 'Schema statement must be between 8 and 50000 characters';
  end if;
  v_command := coalesce((regexp_match(lower(statement), '^[[:space:]]*([a-z]+)'))[1], '');
  if v_command not in ('create','alter','comment','grant','revoke') then
    raise insufficient_privilege using message = 'Only CREATE, ALTER, COMMENT, GRANT and REVOKE schema operations are available';
  end if;
  if v_command = 'alter' and statement ~* '\m(drop|rename)\M' then
    raise insufficient_privilege using message = 'Destructive ALTER operations are not available through the autonomous schema tool';
  end if;
  if statement ~* '\m(create|alter)\s+(role|user|database|system)\M'
     or statement ~* '\msecurity\s+definer\M'
     or statement ~* '(auth[.]users|storage[.]|realtime[.]|vault[.]|pg_catalog[.]|information_schema[.])' then
    raise insufficient_privilege using message = 'Schema authoring is limited to ULTRON public objects and invoker functions';
  end if;
  if v_command = 'grant' and statement !~* '\mto\s+authenticated\M' then
    raise insufficient_privilege using message = 'New grants may target the authenticated role only';
  end if;
  if v_command = 'revoke' and statement !~* '\mfrom\s+(public|anon)\M' then
    raise insufficient_privilege using message = 'Revocations may target PUBLIC or anon only';
  end if;
  execute statement;
  v_hash := md5(statement);
  insert into public.ultron_capability_events(owner_id,event_type,details)
  values (v_owner,'supabase.schema_change_applied',jsonb_build_object('command',v_command,'statement_hash',v_hash,'statement_preview',left(statement,500)));
  return jsonb_build_object('ok',true,'command',v_command,'statement_hash',v_hash,'applied',true);
end;
$$;
revoke all on function public.ultron_apply_schema_change(text) from public;
revoke all on function public.ultron_apply_schema_change(text) from anon;
grant execute on function public.ultron_apply_schema_change(text) to authenticated;
