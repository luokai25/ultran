-- Allow direct Supabase Table Editor key entry without persisting plaintext.
-- api_key_input is consumed by a BEFORE trigger and moved into Vault in the same transaction.
do $$
declare
  provider text;
  table_name text;
begin
  foreach provider in array array['openrouter','mistral','cerebras','groq','cohere'] loop
    table_name := 'ultron_' || provider || '_keys';
    execute format('alter table public.%I add column if not exists api_key_input text', table_name);
    execute format('alter table public.%I alter column owner_id set default auth.uid()', table_name);
    execute format('alter table public.%I alter column vault_secret_id set default %L::uuid', table_name, '00000000-0000-0000-0000-000000000000');
    execute format('alter table public.%I alter column key_fingerprint set default repeat(''0'',64)', table_name);
  end loop;
end $$;

create or replace function public.ultron_capture_llm_key_input()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_text text;
  provider_name text;
  fingerprint text;
  secret_id uuid;
begin
  secret_text := nullif(btrim(new.api_key_input), '');
  if secret_text is null then
    if new.vault_secret_id = '00000000-0000-0000-0000-000000000000'::uuid
       or new.key_fingerprint = repeat('0',64) then
      raise exception 'api_key_input_required';
    end if;
    return new;
  end if;

  if length(secret_text) < 8 or length(secret_text) > 8192 then
    raise exception 'invalid_api_key_length';
  end if;

  if new.owner_id is null then
    select i.owner_id into new.owner_id
    from public.ultron_instance i
    where i.id = true
    limit 1;
  end if;
  if new.owner_id is null then
    raise exception 'ultron_owner_not_configured';
  end if;

  provider_name := regexp_replace(tg_table_name, '^ultron_', '');
  provider_name := regexp_replace(provider_name, '_keys$', '');
  fingerprint := encode(extensions.digest(convert_to(secret_text, 'UTF8'), 'sha256'), 'hex');
  secret_id := public.ultron_store_llm_secret(
    new.owner_id,
    secret_text,
    left('ultron-' || provider_name || '-' || fingerprint, 200)
  );

  if tg_op = 'UPDATE' and old.vault_secret_id is not null
     and old.vault_secret_id <> '00000000-0000-0000-0000-000000000000'::uuid then
    perform public.ultron_delete_llm_secret(old.vault_secret_id);
  end if;

  new.vault_secret_id := secret_id;
  new.key_fingerprint := fingerprint;
  new.api_key_input := null;
  new.status := 'pending';
  new.enabled := true;
  new.models := '[]'::jsonb;
  new.cooldown_until := null;
  new.last_checked_at := null;
  new.last_error := null;
  return new;
end;
$$;

revoke all on function public.ultron_capture_llm_key_input() from public, anon, authenticated;

do $$
declare
  provider text;
  table_name text;
begin
  foreach provider in array array['openrouter','mistral','cerebras','groq','cohere'] loop
    table_name := 'ultron_' || provider || '_keys';
    execute format('drop trigger if exists %I on public.%I', table_name || '_capture_key_input', table_name);
    execute format(
      'create trigger %I before insert or update of api_key_input on public.%I for each row when (new.api_key_input is not null) execute function public.ultron_capture_llm_key_input()',
      table_name || '_capture_key_input', table_name
    );
  end loop;
end $$;
