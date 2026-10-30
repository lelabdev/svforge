---
'svforge': patch
---

Generated Base and Dashboard projects now pin `postcss-selector-parser` to the patched 6.1.5 release through a Bun `overrides` entry: `@tailwindcss/typography` pins the vulnerable 6.0.10 exactly, so generated lockfiles inherited CVE-2026-104844 / GHSA-rj75-hqrm-r3gf on every fresh install. The Docker builder lockfile was regenerated from the Dashboard manifest with the documented Bun 1.3.14 procedure, and the reusable-builder consumer fixture moved from Zod 3 to the patched Zod 4.6.6 while keeping its tested builder/consumer version-ownership contract. The repository dependency audit now also covers the Docker builder and consumer lockfiles and rejects obsolete audit exceptions.
