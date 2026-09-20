# Frontend rules

Binds anything under `frontend/` — React components, CSS Modules, theme tokens, routing,
persisted preferences. Repo-wide rules stay in the root `AGENTS.md`.

- **No hardcoded design values in CSS.** Every color = `var(--token)`, every `font-size` = `var(--text-*)`, every spacing (`padding`/`margin`/`gap`) = `var(--space-*)`, every rectangular `border-radius` = `var(--radius)`, every `box-shadow` = `var(--shadow-*)`. CSS lengths use `rem` or viewport-relative units; raw `px` is banned everywhere by `yarn lint:css` (stylelint). Token missing → define it in `styles/theme.css` first (use `0`, not `0px`, for zero). Palette tokens (values that vary per skin/mode) go in `themes.ts`; static tokens (typography, spacing, radius, shadows) go in `theme.css` `:root`.
- **Compose structure from primitives.** New components reuse the shared chrome in `styles/primitives.module.css` (`card` / `button` / `buttonPrimary` / `buttonSecondary` / `buttonDanger` / `buttonGhost` / `badge` / `badgeCompact` / `pill`) via CSS Modules `composes:` rather than re-declaring borders/buttons/badges. They reference only token layers, so anything built on them conforms to the theme by construction. **Static styles live in CSS Modules**; `style={{}}` carries only runtime-computed values. *eslint-enforced (literal values in `style` fail lint).*
- **Follow the existing visual grammar:** the four-tier bordered button ladder (primary / secondary / ghost / danger), what each color means (accent = interactive; the status-dot palette = job outcome; red = destructive/error), the selection treatment, and the tab pattern. Picking a button tier or a color → match an existing use; don't invent a new emphasis or reuse `--accent` for a status.
- **`localStorage` only in `storage.ts`** — components use `useSettings()`; a new persisted preference goes `storage.ts` → `SettingsProvider`. *eslint-enforced.*
- **Never hand-build query strings.** Use `routes.*` from `router.ts`.
- **Frontend config** (the mechanics of the root `AGENTS.md` "tunable constants belong in config" rule): `import.meta.env.VITE_*` with a fallback in `frontend/src/config.ts`.
