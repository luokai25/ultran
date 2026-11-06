alter table public.ultron_connector_connections add column if not exists toolkit_slug text, add column if not exists auth_config_id text;
create index if not exists ultron_connector_connections_external_account_idx on public.ultron_connector_connections(owner_id,external_account_id) where external_account_id is not null;
comment on column public.ultron_connector_connections.auth_config_id is 'Composio auth config identifier; never contains credentials.';
comment on column public.ultron_connector_connections.toolkit_slug is 'Composio toolkit slug used to route tool execution.';