---
'svforge': patch
'@svforge/tiptap': minor
'@svforge/addon-kit': patch
---

`@svforge/tiptap` now ships its own interactive showcase page: `/showcase/tiptap` runs the module's real editor and toolbar over a local document and renders the sanitized preview of the same content as you type, with a reset control and English/French copy merged into `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). Nothing is sent or persisted; the showcase index lists the demo automatically next to the existing DnD and toast demos.
