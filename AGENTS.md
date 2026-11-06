# ULTRON repository guidance

## UI and design work

For any request involving visual design, layout, UX, navigation, responsive behavior, page polish, or UI consistency:
1. Read `DESIGN.md`.
2. Use the project skill at `.agents/skills/ultron-design/SKILL.md` as the required workflow.
3. Audit the complete relevant screen inventory, including secondary pages, nested states, dialogs, sheets, popovers and settings sections. Do not redesign only the chat/home screen.
4. The canonical production web client and Android APK are both built from `apps/phone`. Keep them visually and behaviorally aligned. `apps/web` is a separate Next.js surface and must use the same design tokens.
5. Preserve existing behavior, DOM IDs, event contracts, Supabase security, provider routing, streaming, permissions and Android compatibility unless the task explicitly asks to change them.
6. Verify actual behavior and builds. Never claim a visual/browser check that was not run.

## Repository constraints

- Work only on `main`; do not create branches.
- Keep ULTRON separate from Luo Chat.
- Never print, commit, or expose API keys, tokens, signing credentials or environment secrets.
- Prefer existing dependencies and project conventions. Avoid unnecessary paid services and dependencies.
