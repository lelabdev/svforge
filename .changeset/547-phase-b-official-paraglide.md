---
"svforge": minor
---

New projects now use the official `sv add paraglide` integration for the i18n wiring: `svforge create` runs it first for Base and Dashboard (project.inlang, Vite plugin, `hooks.server.ts`/`hooks.ts`, html lang/dir placeholders), and Better Auth composes its handle after `handleParaglide`. SVForge keeps the FR/EN catalog content, the app shell (app.html icons/theme-init, Navbar/Footer +layout) and the `paraglide-js compile` step in `check`; it no longer ships the inlang project, hooks or hooks.ts. Hook composition now appends the disabled-identity guard to the official sequence.
