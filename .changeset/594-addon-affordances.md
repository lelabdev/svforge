---
"@svforge/tiptap": patch
"@svforge/notifications": patch
"svforge": patch
---

- `@svforge/tiptap`: every toolbar `ToggleGroup` control now declares `cursor-pointer` (Skeleton's `btn` sets no cursor), matching the list/block and link buttons that already did.
- `@svforge/notifications`: the notification popover surface uses the Skeleton `card` radius utility instead of reapplying `rounded-container` by hand (same 12px theme radius, one less manual token).
- `svforge`: compatibility manifest refresh for the bumped add-ons.

Addon-family audit for #594: OAuth buttons, FileUpload, Toaster, DnD, Graph, Blog, Audit and Chat were audited and left unchanged — their pointer states, specialized behaviors (grab cursors, dynamic graph sizing, native file input) and native-button capability contracts are intentional and already correct.
