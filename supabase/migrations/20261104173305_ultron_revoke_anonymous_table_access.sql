revoke all on table
  public.ultron_instance,
  public.ultron_conversations,
  public.ultron_messages,
  public.ultron_memory_items,
  public.ultron_memory_relations,
  public.ultron_documents,
  public.ultron_document_chunks,
  public.ultron_tasks,
  public.ultron_tool_permissions,
  public.ultron_tool_runs,
  public.ultron_model_profiles,
  public.ultron_settings,
  public.ultron_device_sync
from anon;

alter default privileges in schema public revoke all on tables from anon;
