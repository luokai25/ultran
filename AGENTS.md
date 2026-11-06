# ULTRON repository guidance

## Product workflow

For substantial product, design, engineering, review, QA or release work:
1. Read this file and the relevant project docs.
2. Use `.agents/skills/ultron-gstack/SKILL.md` as the product-to-production workflow.
3. For visual/UI work, also use `.agents/skills/ultron-design/SKILL.md` and read root `DESIGN.md`.
4. Update `docs/ULTRON-SCREEN-COVERAGE.md` when screens, states or design coverage change.

## UI and design work

For any request involving visual design, layout, UX, navigation, responsive behavior, page polish, or UI consistency:
1. Read `DESIGN.md` completely.
2. Run the ULTRON gstack workflow before implementation and the ULTRON Design Studio workflow during implementation.
3. Audit the complete relevant screen inventory, including secondary pages, nested states, dialogs, sheets, popovers and settings sections. Do not redesign only the chat/home screen.
4. The canonical production web client and Android APK are both built from `apps/phone`. Keep them visually and behaviorally aligned. `apps/web` is a separate Next.js surface and must use the same design tokens.
5. Preserve existing behavior, DOM IDs, event contracts, Supabase security, provider routing, streaming, permissions and Android compatibility unless the task explicitly asks to change them.
6. Verify actual behavior and builds. Never claim a visual/browser/device check that was not run.

## Repository constraints

- Work only on `main`; do not create branches.
- Keep ULTRON separate from Luo Chat.
- Never print, commit, or expose API keys, tokens, signing credentials or environment secrets.
- Do not weaken authentication, RLS, approvals, connector scopes or permission boundaries.
- Preserve working features and concurrent contributors' commits.
- Prefer existing dependencies and project conventions. Avoid unnecessary paid services and dependencies.
