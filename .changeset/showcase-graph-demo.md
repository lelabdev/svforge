---
'svforge': patch
'@svforge/graph': minor
'@svforge/addon-kit': patch
---

`@svforge/graph` now ships its own interactive showcase page: `/showcase/graph` renders the module's real `KnowledgeGraph` over a local fixture, mirrors node selection in a live panel (`aria-live`) with keyboard-reachable node buttons next to the canvas interaction, and keeps English/French copy — including the fixture labels — in `messages/*.json` on install (the module now declares `ui.svforge` and `i18n.messages`). Nothing is fetched or persisted; the showcase index lists the demo automatically alongside the DnD, toast and Tiptap demos.
