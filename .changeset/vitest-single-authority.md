---
'svforge': patch
'@svforge/uploads': patch
---

One Vitest authority for every scaffold: the Dashboard no longer declares its own runner (it inherits Base's `^5.0.0`) and its reference manifest mirrors that, while the optional uploads testpack now declares the same version instead of downgrading to Vitest 4. The reusable Docker builder lockfile was regenerated with the documented Bun 1.3.14 procedure and validated by the builder smoke test. The Dashboard PostgreSQL suites (10 files / 46 tests) and the `dashboard-integrations` composition including the uploads security pack (11 files / 53 tests) were run green on Vitest 5 against a real PostgreSQL 17.2. The uploads showcase drop zone also gained an accessible `role="group"`, and every showcase demo page is now guarded against compiler/a11y warnings.
