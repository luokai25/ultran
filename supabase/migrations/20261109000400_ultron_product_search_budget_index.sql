create index if not exists ultron_product_events_owner_type_created_at_idx
  on public.ultron_product_events (owner_id, event_type, created_at desc);
