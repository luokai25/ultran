-- Keep schema authoring behind the authenticated Edge Function and its service-only RPC.
-- The legacy JWT-callable SECURITY DEFINER entry point is no longer used by the runtime.
alter function public.ultron_apply_schema_change(text) security invoker;
revoke all on function public.ultron_apply_schema_change(text) from public, anon, authenticated;
