---
'svforge': patch
'@svforge/ui_toast': minor
'@svforge/addon-kit': patch
---

`@svforge/ui_toast` now ships its own interactive showcase page: `/showcase/ui-toast` fires the module's real toaster store for the success, error, info and warning variants, mounts its own `Toaster` group so it works before the root layout is wired, and keeps English/French copy in `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). The showcase index lists it automatically next to the existing DnD demo.
