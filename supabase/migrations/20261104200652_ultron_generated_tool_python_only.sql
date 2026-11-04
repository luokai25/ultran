-- The current generated-tool policy and isolated worker support Python run(payload) only.
alter table public.ultron_generated_tools
  drop constraint if exists ultron_generated_tools_source_language_check;
alter table public.ultron_generated_tools
  add constraint ultron_generated_tools_source_language_check
  check (source_language = 'python');
