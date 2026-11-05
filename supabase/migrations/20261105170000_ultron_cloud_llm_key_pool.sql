-- ULTRON cloud LLM key pools. Plaintext credentials live only in Supabase Vault.
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  provider text;
  table_name text;
begin
  foreach provider in array array['openrouter','mistral','cerebras','groq','cohere'] loop
    table_name := 'ultron_' || provider || '_keys';
    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        owner_id uuid not null references auth.users(id) on delete cascade,
        label text not null default 'API key' check (length(label) between 1 and 100),
        vault_secret_id uuid not null unique,
        key_fingerprint text not null check (key_fingerprint ~ '^[a-f0-9]{64}$'),
        status text not null default 'pending' check (status in ('pending','connected','invalid','expired','rate_limited','unreachable','disabled')),
        enabled boolean not null default true,
        priority smallint not null default 3 check (priority between 1 and 5),
        models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array'),
        request_count bigint not null default 0 check (request_count >= 0),
        tokens_used bigint not null default 0 check (tokens_used >= 0),
        cooldown_until timestamptz,
        last_used_at timestamptz,
        last_checked_at timestamptz,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(owner_id, key_fingerprint)
      )
    $ddl$, table_name);

    execute format('create index if not exists %I on public.%I(owner_id, enabled, status, priority, created_at)', table_name || '_pool_idx', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_select', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = owner_id and exists (select 1 from public.ultron_instance i where i.id = true and i.owner_id = (select auth.uid())))', table_name || '_owner_select', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.ultron_set_updated_at()', table_name || '_updated_at', table_name);
  end loop;
end $$;

create or replace function public.ultron_store_llm_secret(p_owner_id uuid, p_secret text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid;
begin
  if p_secret is null or length(p_secret) < 8 or length(p_secret) > 8192 then
    raise exception 'invalid_secret_length';
  end if;
  if not exists (select 1 from public.ultron_instance i where i.id = true and i.owner_id = p_owner_id) then
    raise exception 'owner_instance_required';
  end if;
  select vault.create_secret(p_secret, left(p_name, 200), 'ULTRON provider credential') into secret_id;
  return secret_id;
end;
$$;

create or replace function public.ultron_read_llm_secret(p_secret_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.id = p_secret_id
  limit 1;
$$;

create or replace function public.ultron_delete_llm_secret(p_secret_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = p_secret_id;
  return found;
end;
$$;

create or replace function public.ultron_get_system_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name = p_name
  limit 1;
$$;

revoke all on function public.ultron_store_llm_secret(uuid,text,text) from public, anon, authenticated;
revoke all on function public.ultron_read_llm_secret(uuid) from public, anon, authenticated;
revoke all on function public.ultron_delete_llm_secret(uuid) from public, anon, authenticated;
revoke all on function public.ultron_get_system_secret(text) from public, anon, authenticated;
grant execute on function public.ultron_store_llm_secret(uuid,text,text) to service_role;
grant execute on function public.ultron_read_llm_secret(uuid) to service_role;
grant execute on function public.ultron_delete_llm_secret(uuid) to service_role;
grant execute on function public.ultron_get_system_secret(text) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ultron_brain_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ultron_brain_cron_secret', 'Internal authentication for ULTRON cloud brain scheduled worker');
  end if;
end $$;

select cron.schedule(
  'ultron-brain-supervisor',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://vshoxrtrfleptqxkrmtc.supabase.co/functions/v1/ultron-brain',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ultron-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ultron_brain_cron_secret')
      ),
      body := jsonb_build_object('action', 'worker', 'limit', 2),
      timeout_milliseconds := 10000
    );
  $job$
);
