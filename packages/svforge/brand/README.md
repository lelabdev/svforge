# SVForge brand favicons (canonical)

Canonical binary favicon assets shipped to every Base and Dashboard scaffold
(#613). They are the SVForge brand favicon set used by the
`svelteForge-website` project (`static/favicon.ico` and `static/favicon/*`),
vendored here so the scaffold build never depends on a sibling checkout.

| File | Format | Purpose |
|---|---|---|
| `favicon.ico` | ICO (16/32/48 frames) | primary `/favicon.ico` |
| `favicon-32x32.png` | PNG 32×32 | `<link rel="icon" sizes="32x32">` |
| `favicon-16x16.png` | PNG 16×16 | `<link rel="icon" sizes="16x16">` |
| `apple-touch-icon.png` | PNG 180×180 | iOS home screen |

## How they reach generated projects

The SVForge template manifest embeds every delivered file as a UTF-8 string, so
binaries cannot be shipped verbatim. `packages/svforge/scripts/prebuild.ts`
embeds these files as base64 into
`packages/svforge/templates/base/src/lib/assets/brand-favicons.ts`, and the
prerendered routes (`/favicon.ico`, `/favicon/favicon-32x32.png`,
`/favicon/favicon-16x16.png`, `/favicon/apple-touch-icon.png`) decode them with
the correct `Content-Type`.

`tests/favicon-delivery.test.ts` asserts the shipped bytes still match these
canonical files, so replacing an icon here requires regenerating through
`bun run prebuild` (never hand-editing the generated module).

## Updating

Replace the files here with the new brand set, then run
`bun run prebuild` in `packages/svforge` and commit the regenerated
`templates.ts` together with the new binaries.
