-- Keep the per-owner settings channel in sync across authenticated ULTRON devices.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'ultron_settings'
    )
  then
    alter publication supabase_realtime add table public.ultron_settings;
  end if;
end;
$$;
