alter table public.ultron_tool_runs
  drop constraint ultron_tool_runs_task_id_owner_id_fkey;
alter table public.ultron_tool_runs
  add constraint ultron_tool_runs_task_id_owner_id_fkey
  foreign key (task_id, owner_id)
  references public.ultron_tasks(id, owner_id)
  on delete set null (task_id);

create index if not exists ultron_messages_conversation_owner_fk_idx
  on public.ultron_messages(conversation_id, owner_id);
create index if not exists ultron_documents_owner_fk_idx
  on public.ultron_documents(owner_id);
create index if not exists ultron_document_chunks_document_owner_fk_idx
  on public.ultron_document_chunks(document_id, owner_id);
create index if not exists ultron_memory_relations_source_owner_fk_idx
  on public.ultron_memory_relations(source_memory_id, owner_id);
create index if not exists ultron_memory_relations_target_owner_fk_idx
  on public.ultron_memory_relations(target_memory_id, owner_id);
create index if not exists ultron_tool_runs_task_owner_fk_idx
  on public.ultron_tool_runs(task_id, owner_id);
