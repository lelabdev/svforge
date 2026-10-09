# Structural duplication check

An experimental, opt-in detector reports likely copies of existing SvelteForge or Skeleton components. It is **WARN-only** and does not change files or block a check.

Enable it for a generated project with:

```bash
SVFORGE_EXPERIMENTAL_STRUCTURAL_DUPLICATION=1 bun svforge-check.mjs
```

Programmatic callers can pass `{ experimentalStructuralDuplication: true }` to `checkDesignSystem`. Findings identify the component or Skeleton source to reuse. The detector is intentionally optional while false positives are reviewed; ordinary design-system checks remain available without it.
