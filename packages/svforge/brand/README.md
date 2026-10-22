# SVForge brand favicons (canonical)

The canonical SVForge favicon set for the Base and Dashboard scaffolds (#613)
comes from `svelteForge-website/static/favicon.ico` and
`svelteForge-website/static/favicon/`. The seven original files are vendored
here, so creating an app does not depend on a sibling website checkout.

| Canonical file | Format | Delivered URL |
| --- | --- | --- |
| `favicon.ico` | ICO, 16/32/48 frames | `/favicon.ico` |
| `favicon-16x16.png` | PNG, 16×16 | `/favicon/favicon-16x16.png` |
| `favicon-32x32.png` | PNG, 32×32 | `/favicon/favicon-32x32.png` |
| `apple-touch-icon.png` | PNG, 180×180 | `/favicon/apple-touch-icon.png` |
| `android-chrome-192x192.png` | PNG, 192×192 | `/favicon/android-chrome-192x192.png` |
| `android-chrome-512x512.png` | PNG, 512×512 | `/favicon/android-chrome-512x512.png` |
| `site.webmanifest` | JSON web manifest | `/site.webmanifest` |

## How they reach generated projects

The SVForge template manifest contains UTF-8 strings, so binary images cannot
be copied into it directly. `packages/svforge/scripts/prebuild.ts` embeds the
six image files as base64 in the **generated**
`templates/base/src/lib/assets/brand-favicons.ts` module. The six prerendered
routes decode those bytes into real assets with `image/x-icon` or
`image/png` responses. Both Base and Dashboard inherit this delivery.

The web manifest is copied to
`templates/base/root/static/site.webmanifest`, and `app.html` links to all
six image URLs and the manifest. The current vendor manifest has blank
`name` / `short_name` fields; they do not supply a generated application's
name. Do not confuse brand asset delivery with full project-specific PWA
configuration.

`tests/favicon-delivery.test.ts` verifies image identity against these
canonical files, routing, manifest delivery, and the generated app. No second
logo should be drawn or independently maintained.

## Updating

Obtain the *approved* new brand asset set and update the files here, including
the web manifest. Run `bun run prebuild` inside `packages/svforge`, then
commit all changed canonical assets, generated template files, and relevant
tests together. Never hand-edit the generated base64 module.
