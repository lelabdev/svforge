---
'svforge': minor
'@svforge/dnd': minor
'@svforge/addon-kit': patch
---

The design-system gallery moved from `/demo-ui` to `/showcase`, and the showcase is now the discovery surface for module demos. Each installed module can ship a self-contained demo route plus a `meta.ts` (`title`, optional `description`, optional `order`, as locale functions); the index lists them with a build-time glob, so a plain Base project imports no module code and renders no empty section. `@svforge/dnd` is the pilot: `/showcase/dnd` reorders a real `SortableList` with local fixture data and shows the resulting order, with English/French copy merged into `messages/*.json` on install (the module now declares `ui.svforge` + `i18n.messages`).
