---
"svforge": patch
---

Add a shared `PasswordInput` field to the dashboard template: the login and setup screens compose one masked/unmasked field with an accessible Show/Hide control instead of re-implementing the eye toggle and local visibility state in each route. Generated agent guidance and `llms.txt` patterns now point at the shared field.
