---
"svforge": patch
---

Dashboard `PasswordInput`: inline the single-use `toggleLabel` derivation into the reveal control's `aria-label` (same reactive behavior, one less intermediate). Dashboard family audit for #594: no other verified change — AdminLayout, AppDialog, AvatarInitial, Feedback and the dashboard routes already use Skeleton v5 components/shared primitives and satisfy the enabled/disabled pointer-cursor contract.
