---
"svforge": patch
---

Make Dashboard local setup prepare a private, ignored .env idempotently, preserving existing credentials and valid Better Auth secrets. Refuse a .env that Git already tracks (staged or committed) instead of writing a generated secret into a committable file. Remove automatic forced schema pushes; report manual database steps and support deferring configuration.
