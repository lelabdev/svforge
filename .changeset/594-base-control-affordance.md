---
"svforge": patch
---

Base primitives: `Checkbox` and `Toggle` now follow the project-wide pointer-affordance contract — an enabled control shows `cursor-pointer`, a disabled one shows `cursor-not-allowed` (Skeleton v5 sets neither for these controls). The `Checkbox` label no longer advertises clickability when the input is disabled, and the `Toggle` forwards the same states to its Skeleton `Switch` control and label. No API or behavior change beyond the cursor affordance.
