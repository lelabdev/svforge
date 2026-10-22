---
"svforge": patch
---

Ship the real SVForge brand favicon in Base and Dashboard scaffolds instead of the cyan-square/white-triangle placeholder: the canonical brand binaries are vendored once in `packages/svforge/brand/`, embedded as base64 by prebuild, and served by prerendered `/favicon.ico` and `/favicon/*.png` routes with correct `Content-Type`. `app.html` declares the same icons, and the generated-site browser smoke now verifies the served bytes.
