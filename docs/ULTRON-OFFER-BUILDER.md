# ULTRON Offer Builder

The Offer Builder preserves the supplied ULTRON-branded HTML experience and connects its generation actions to the private ULTRON backend.

## Runtime path

- `apps/phone/src/product-studio.ts` mounts the Offer Builder in an iframe overlay when Product Studio is opened.
- `apps/phone/src/offer-builder-asset.ts` contains the gzip-compressed HTML asset. The app decompresses it at runtime; the screen's visual layout remains inside that document.
- The iframe and host communicate through a strict `ULTRON_OFFER_ACTION` message bridge. The host checks the message source and only allows the `create`, `get`, `save`, `generate`, and `finalize` actions.
- The host invokes the Supabase Edge Function with the signed-in ULTRON session. Provider credentials are never sent to the iframe.

## Backend

The `ultron-offer-builder` Edge Function authenticates the user and verifies ownership of the ULTRON instance. It uses the signed-in user's authorization when calling `ultron-brain`, so the existing provider selection, key rotation, and fallback system remain the single source of truth for model access.

Supported actions:

- `create`: create an Offer Builder project.
- `get`: restore a project and its saved state.
- `save`: persist UI state and checkpoints.
- `generate`: run discovery, sequential outline options, transformation mapping, manuscript sections, branding, or store-copy generation.
- `finalize`: save the finished Markdown manuscript to the private `ultron-private` bucket and register it in `ultron_product_documents`.

Project state and events use `ultron_product_projects` and `ultron_product_events`. Final documents are registered in `ultron_product_documents`.

## Generation stages

- Discovery: 12 market directions, specific opportunity brainstorming, and weighted scoring (pain 30%, worsening 25%, purchasing power 30%, speed to outcome 15%).
- Outline: three sequentially generated alternatives, each informed by the previous alternatives.
- Transformation: before/after states and a staged path to the outcome.
- Section: individual manuscript sections generated in parallel waves and saved as they complete.
- Branding: palette, typography direction, cover concept, and product copy.
- Store: product-page copy, benefits, FAQ, and suggested price.

The backend also exposes summary and quality-review stages for future UI wiring.

## Current boundaries

- Creator analysis uses information supplied in the form. A public handle or URL alone is not treated as proof that a profile was scraped.
- The current cover is a styled HTML cover concept; image-file generation is not yet connected.
- The store page is generated and saved to the ULTRON project. It is not automatically published to Shopify.
- The final export currently saved by this flow is Markdown. PDF/DOCX export can be added through the existing artifact/document pipeline.
- Generation is server-backed and checkpoints are persisted, but the Offer Builder is not yet a durable background job queue. Completed sections survive a reload; unfinished sections can be resumed from the saved project.

## Security

Never embed OpenRouter, Groq, Google AI Studio, Supabase service-role, or other provider secrets in the HTML asset, iframe messages, browser storage, or APK. Provider secrets remain in ULTRON's existing server-side key system and are accessed through `ultron-brain`.
