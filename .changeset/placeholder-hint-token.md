---
'svforge': patch
---

Give form-field hint text its own theme token: `--field-placeholder` now resolves to `surface-600` in light mode and `surface-300` in dark mode, so an empty field's placeholder reads as a hint instead of looking like typed text, while staying AA-legible against the field surface. Nothing changes for entered or prefilled values, and the scaffolded guidance tells projects to adjust the theme token instead of adding per-page `placeholder:` colors.
