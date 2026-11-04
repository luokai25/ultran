alter table public.ultron_skills drop constraint if exists ultron_skills_version_check;
alter table public.ultron_skills add constraint ultron_skills_version_check check (version ~ '^[0-9]+[.][0-9]+[.][0-9]+$');
alter table public.ultron_tool_specs drop constraint if exists ultron_tool_specs_version_check;
alter table public.ultron_tool_specs add constraint ultron_tool_specs_version_check check (version ~ '^[0-9]+[.][0-9]+[.][0-9]+$');
