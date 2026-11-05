-- Ensure direct provider-key inserts cannot silently create placeholder rows.
do $$
declare
  provider text;
  table_name text;
begin
  foreach provider in array array['openrouter','mistral','cerebras','groq','cohere'] loop
    table_name := 'ultron_' || provider || '_keys';
    execute format('drop trigger if exists %I on public.%I', table_name || '_capture_key_input', table_name);
    execute format(
      'create trigger %I before insert or update of api_key_input on public.%I for each row execute function public.ultron_capture_llm_key_input()',
      table_name || '_capture_key_input', table_name
    );
  end loop;
end $$;
