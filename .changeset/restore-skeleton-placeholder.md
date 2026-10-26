---
'svforge': patch
---

Restore Skeleton UI v5's native form placeholder styling by removing the SVForge theme override of `--field-placeholder`. Input and Textarea continue to use Skeleton's standard utilities; individual forms distinguish example placeholders from actual field values semantically instead of via a global color override.
