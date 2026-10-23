---
"svforge": patch
---

A direct `sv add <svforge-addon>=template:<base|dashboard>` now fails closed before writing anything when the official Paraglide/Drizzle/Better Auth output is missing, and prints the exact supported manual sequence (or points to `svforge create`, which runs those add-ons first). Generated agent guidance documents the ordering. No generated project changes when the official add-ons are already present.
