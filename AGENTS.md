# ULTRON repository guidance

## Product topology

- `apps/phone` is the only client. It is a Vite web app and the source bundled into the Capacitor Android APK.
- Vercel hosts the web client at https://ultron-pied-gamma.vercel.app/.
- Supabase provides the cloud brain, database, Vault, scheduled workers and artifact storage.
- `packages/connectors` is the shared connector SDK and manifest source.
- `ultron-backend` is an optional Python control plane for agent sessions, background tasks and connector operations. Core cloud chat does not depend on it.
- Do not recreate separate Next.js or Expo clients, or route the web app through Cloudflare.

## Engineering rules

For substantial engineering work, follow `.agents/skills/ultron-gstack/SKILL.md`. For interface work, also follow `.agents/skills/ultron-design/SKILL.md`.


1. Work only on `main`. Never create or push another branch.
2. Keep ULTRON separate from Luo Chat.
3. Inspect current `main` and relevant tests before every write.
4. Preserve working features, provider routing, streaming, local model import, memory, artifacts and background jobs.
5. The public client is single-instance: no visitor sign-up or login flow. Do not add user-account setup screens.
6. Provider API keys stay in Supabase Vault and are used server-side. Never expose, echo, commit or log provider keys, service-role credentials, signing keys or tokens.
7. Do not remove Vault, database ownership integrity, connector permission checks or tool approval boundaries as a shortcut.
8. Delete a code path only after checking its runtime imports, build references, tests and docs. Remove its tests and docs in the same change.
9. Keep dependencies minimal. Do not add frameworks or services when the existing Vite, Capacitor, Supabase and Python stack is sufficient.
10. Update the README and relevant architecture/screen documentation when project structure or behavior changes.

## Verification

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
cd ultron-backend && python -m pytest -q
```

For Android changes, verify the Android release workflow. For web changes, verify the Vercel production deployment. Never claim a browser, device, test or deployment check that was not actually completed.
