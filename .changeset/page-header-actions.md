---
"svforge": patch
---

Add a canonical `layout/PageHeader.svelte` to the Base/Dashboard templates and compose the Dashboard admin page headers with it, so equivalent primary actions share the shared Button defaults: the `Manage users` CTA no longer pins `size="sm"` while `Add user` relies on the default. `svforge check` now warns (`pageHeaderActionSize`) when a page-header action pins its own size — table rows, toolbars and icon-only controls are never inspected. Generated AGENTS.md/`llms.txt` guidance and `svforge-catalog.json` document the default-first rule, the full-width-admin vs constrained-form policy and the optional decorative page-title icon policy.
