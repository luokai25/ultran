-- Add Google AI Studio (Gemini API) to the shared cloud provider key pool.
-- Match the existing provider table schema and keep credentials in Supabase Vault.
create table if not exists public.ultron_google_ai_studio_keys
  (like public.ultron_openrouter_keys including all);

alter table public.ultron_google_ai_studio_keys
  add constraint ultron_google_ai_studio_keys_owner_fk
  foreign key (owner_id) references auth.users(id) on delete cascade;

create index if not exists ultron_google_ai_studio_keys_pool_idx
  on public.ultron_google_ai_studio_keys(owner_id, enabled, status, priority, created_at);

alter table public.ultron_google_ai_studio_keys enable row level security;
drop policy if exists ultron_google_ai_studio_keys_owner_select on public.ultron_google_ai_studio_keys;
create policy ultron_google_ai_studio_keys_owner_select
  on public.ultron_google_ai_studio_keys
  for select to authenticated
  using (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.ultron_instance i
      where i.id = true and i.owner_id = (select auth.uid())
    )
  );
grant select on public.ultron_google_ai_studio_keys to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.ultron_google_ai_studio_keys from anon, authenticated;

 drop trigger if exists ultron_google_ai_studio_keys_updated_at on public.ultron_google_ai_studio_keys;
create trigger ultron_google_ai_studio_keys_updated_at
  before update on public.ultron_google_ai_studio_keys
  for each row execute function public.ultron_set_updated_at();

drop trigger if exists ultron_google_ai_studio_keys_capture_key_input on public.ultron_google_ai_studio_keys;
create trigger ultron_google_ai_studio_keys_capture_key_input
  before insert or update of api_key_input on public.ultron_google_ai_studio_keys
  for each row when (new.api_key_input is not null)
  execute function public.ultron_capture_llm_key_input();
