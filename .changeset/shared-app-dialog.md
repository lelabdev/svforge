---
"svforge": patch
---
Add a shared `AppDialog` modal shell to the dashboard template: admin forms and confirmations compose one Skeleton dialog composition (title, size, controlled open state, accessible close control, focus trap/restore and the outside-click policy) instead of re-implementing `Dialog/Portal/Backdrop/Positioner` in each route. Generated agent guidance and `llms.txt` patterns now point at the shell, and the users Playwright suite asserts an opaque, hit-testable panel on desktop and mobile.
