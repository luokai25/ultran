
create index if not exists ultron_product_projects_artifact_fk_idx on public.ultron_product_projects(artifact_id) where artifact_id is not null;
create index if not exists ultron_product_projects_source_job_fk_idx on public.ultron_product_projects(source_job_id) where source_job_id is not null;
create index if not exists ultron_product_projects_owner_fk_idx on public.ultron_product_projects(owner_id);
create index if not exists ultron_product_sources_owner_fk_idx on public.ultron_product_sources(owner_id);
create index if not exists ultron_product_events_owner_fk_idx on public.ultron_product_events(owner_id);
create index if not exists ultron_product_documents_owner_fk_idx on public.ultron_product_documents(owner_id);
