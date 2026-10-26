---
'svforge': minor
'@svforge/chat': patch
'@svforge/audit': patch
---

New projects now start in **English** (`baseLocale: "en"`, locales `["en","fr"]`) and ship a reusable `ui/LocaleSwitcher.svelte` in the Base navbar and the Dashboard shell. The switcher reads the project's configured Paraglide locales (adding a third language needs no component change), marks the active locale, keeps the current route, query string and fragment, and forces the document reload Paraglide needs to render the new copy and `<html lang>`. Its anchors stay in the server-rendered HTML, so prerendered localized routes keep being discovered without the previous hidden locale-link block. Internal navigation (navbar, footer, landing page, dashboard sidebar, audit pagination, chat list) now goes through `localizeHref()`, so navigating from `/fr/...` no longer silently returns to English.
