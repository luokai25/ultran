-- The Google AI Studio key table copied the OpenRouter pool index via LIKE INCLUDING ALL.
-- Keep the explicitly named pool index and remove the duplicate copied index.
drop index if exists public.ultron_google_ai_studio_keys_owner_id_enabled_status_priori_idx;
