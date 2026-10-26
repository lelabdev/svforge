# Skeleton v5-first scaffolded UI baseline

SVForge ships a **starting point**, not a component library: every scaffolded `.svelte` under `packages/*/templates/src/**` composes Tailwind CSS v4 utilities with the Skeleton UI v5 primitives SVForge already depends on (`@skeletonlabs/skeleton@^5`, `@skeletonlabs/skeleton-svelte@^5`). This page records the audit disposition from issue #594 and the rule that keeps it true.

## Styling policy

- **Tailwind + Skeleton only.** Component appearance is expressed in `class`/`class:…` attributes (through `cn()` when a class is composed). No `<style>` blocks, no handwritten selectors for component appearance, no component-level CSS files, no inline `style=` standing in for a utility, no second styling layer.
- **Prefer the native Skeleton utility.** `btn`, `btn-icon`, `card`, `input`, `select`, `textarea`, `checkbox`, `table`, `table-wrap`, `badge`, `chip`, `anchor`, `kbd`, and the `preset-*` families own their properties. Tailwind owns layout, spacing, responsive behaviour and states Skeleton does not provide. Do not recreate a Skeleton property with a utility list, and do not "clean up" a class without checking the Skeleton v5 CSS and the shipped theme.
- **Configuration is not bespoke CSS.** `src/routes/layout.css` (Tailwind/Skeleton/plugin imports) and `src/lib/styles/svelteforge-theme.css` (documented Skeleton theme tokens, light + dark) are required integration, not component styling.
- **Reactive plumbing is not churn.** A `$derived` stays when it is reused, when it is the readable form of a shared computation, or when it feeds real reactive behaviour (`inactive` in `Button`, the SSR-stable ids and `aria-describedby` joins in `Input`/`Select`/`Textarea`). Only single-use intermediates that are provably shorter inlined were removed.
- **Specialised behaviour keeps its owner.** Tiptap, DnD, force-graph rendering, uploads, auth, notifications and other business logic were not rewritten to swap DOM for Skeleton components.

### Form field hint text

Skeleton's `input` and `textarea` utilities paint `::placeholder` with the single `--field-placeholder` theme token, so the hint/value distinction comes from the theme rather than from per-component classes:

- `svelteforge-theme.css` sets `--field-placeholder: light-dark(var(--color-surface-600), var(--color-surface-300))`. On the field surface that measures ~7.5:1 (light) and ~6.6:1 (dark) for the hint against ~16.6:1 for an entered value: AA-legible and still visibly secondary. Skeleton's stock default (`surface-700-300`) reads almost as strongly as typed text in light mode.
- The token is consumed only inside `::placeholder`, so a typed or prefilled `value` keeps the normal field foreground, and focus, validation and disabled states never repaint the hint (`@tailwindcss/forms` may set a literal gray for bare `<input>` elements, but the `input`/`textarea` utilities win for the scaffolded primitives).
- Do not add `placeholder:text-*` utilities or per-page hint colors; change the theme token once. `tests/placeholder-contrast.test.ts` computes the contrast from the shipped `oklch()` stops and fails when hints become indistinguishable from input text, fall below 4.5:1, or are overridden per page.

### Pointer affordance contract

Every **enabled** actionable control advertises `cursor-pointer`; a **disabled/loading** control advertises `cursor-not-allowed` (or the appropriate default) and never looks clickable. Skeleton v5's `btn`/`btn-icon` set no `cursor` for the enabled state (only the global `:disabled` rule), so the affordance must be declared by whoever owns the control: the shared `Button` primitive for consumers of it, the component itself for native/library triggers. Static text and non-actions receive no pointer.

## Per-file disposition

Every scaffolded `.svelte` file is listed with its disposition. Legend:

- **Already native** — audited, already Tailwind/Skeleton; deliberately unchanged (churn without simplification was rejected).
- **Simplified** — a verified, behaviour-preserving simplification landed.
- **Corrected** — a real affordance or policy defect was fixed.
- **Specialised** — an intentional implementation whose behaviour cannot be expressed by a Skeleton primitive.

The audit originally counted 43 files. The scan is now **46**: `layout/PageHeader.svelte` (#601), `ui/AppDialog.svelte` and `ui/PasswordInput.svelte` (#603) were added after the issue was written and are audited here.

### Base template (20)

| File | Disposition |
| --- | --- |
| `packages/svforge/templates/base/src/lib/components/svforge/primitives/Badge.svelte` | Already native — `badge` utility plus one inline preset lookup; Skeleton v5 has no badge size utilities, so none are emitted. |
| `packages/svforge/templates/base/src/lib/components/svforge/primitives/Button.svelte` | Corrected — the shared affordance owner: one `cn()` for the shared classes (size/preset/cursor inlined, #593), `cursor-pointer` when enabled, `cursor-not-allowed` when disabled/loading, and inert-but-focusable anchors. |
| `packages/svforge/templates/base/src/lib/components/svforge/primitives/Checkbox.svelte` | Corrected — the clickable label follows the input state instead of being unconditionally `cursor-pointer`. |
| `packages/svforge/templates/base/src/lib/components/svforge/primitives/Input.svelte` | Already native — `input` utility; SSR-stable id/`aria-describedby` derivations are reused and kept. |
| `packages/svforge/templates/base/src/lib/components/svforge/primitives/Select.svelte` | Already native — `select` utility; same reused id/aria derivations. |
| `packages/svforge/templates/base/src/lib/components/svforge/primitives/Textarea.svelte` | Already native — `textarea` utility; same reused id/aria derivations. |
| `packages/svforge/templates/base/src/lib/components/svforge/primitives/Toggle.svelte` | Corrected — thin composition over the official Skeleton `Switch`; control and label declare pointer/not-allowed and the hidden input keeps native form participation. |
| `packages/svforge/templates/base/src/lib/components/svforge/ui/Alert.svelte` | Already native — `card` plus a tonal preset computed inline; no info tonal preset is invented. |
| `packages/svforge/templates/base/src/lib/components/svforge/ui/Card.svelte` | Already native — the `card` utility owns the radius, `p-4` stays because `card` applies no padding; one variant lookup map. |
| `packages/svforge/templates/base/src/lib/components/svforge/ui/LocaleSwitcher.svelte` | Already native — render-free Paraglide switcher: Skeleton `btn`/`btn-sm` plus the active/tonal presets on plain anchors, `min-h-11` touch targets and `cursor-pointer` on every enabled link; no wrapper CSS. |
| `packages/svforge/templates/base/src/lib/components/svforge/ui/Logo.svelte` | Already native — `rounded-container` and a tonal preset around the Phosphor icon. |
| `packages/svforge/templates/base/src/lib/components/svforge/ui/Seo.svelte` | Already native — no styling layer; the derived URL/image/card values are reused head metadata. |
| `packages/svforge/templates/base/src/lib/components/svforge/ui/Table.svelte` | Already native — `table-wrap`/`table` utilities; the row-key contract and its dev warning are behaviour, not styling. |
| `packages/svforge/templates/base/src/lib/components/svforge/ui/ThemeToggle.svelte` | Already native — the shared `Button` owns the affordance; theme persistence logic untouched. |
| `packages/svforge/templates/base/src/lib/components/svforge/layout/AuthLayout.svelte` | Already native — layout utilities only; the action is `ThemeToggle`. |
| `packages/svforge/templates/base/src/lib/components/svforge/layout/Footer.svelte` | Already native — layout/border utilities; links use the `anchor` utility (native pointer). |
| `packages/svforge/templates/base/src/lib/components/svforge/layout/Navbar.svelte` | Already native — shared `Button` for the mobile toggle, `anchor` links, `ThemeToggle`. |
| `packages/svforge/templates/base/src/lib/components/svforge/layout/PageHeader.svelte` | Already native — shell composition without a control of its own; the action snippet takes shared `Button` children. |
| `packages/svforge/templates/base/src/routes/+layout.svelte` | Already native — the hidden locale helper links use the `hidden` utility instead of an inline `display:none`. |
| `packages/svforge/templates/base/src/routes/+page.svelte` | Already native — shared `Button`/`Card` with layout utilities. |
| `packages/svforge/templates/base/src/routes/showcase/+page.svelte` | Corrected — the three native brand-preset buttons declare `cursor-pointer`; every other control is a shared primitive, and typography uses `h1`–`h6`/`anchor`/`kbd`. |

### Dashboard template (12)

| File | Disposition |
| --- | --- |
| `packages/svforge/templates/dashboard/src/lib/components/svforge/layout/AdminLayout.svelte` | Already native — Skeleton `Dialog` shell plus shared `Button`: both dialog triggers and the close control declare `cursor-pointer`, navigation is anchors, no handwritten CSS. |
| `packages/svforge/templates/dashboard/src/lib/components/svforge/ui/AppDialog.svelte` | Already native — one Skeleton `Dialog` composition with a `card` surface, a size map, and a `btn-icon` close trigger that declares its affordance. |
| `packages/svforge/templates/dashboard/src/lib/components/svforge/ui/AvatarInitial.svelte` | Already native — the initial is already inlined; the size map stays because it is clearer than a nested ternary. |
| `packages/svforge/templates/dashboard/src/lib/components/svforge/ui/Feedback.svelte` | Already native — tonal presets plus `rounded-container`; dismissal is a shared `Button`. |
| `packages/svforge/templates/dashboard/src/lib/components/svforge/ui/PasswordInput.svelte` | Simplified — the single-use reveal label derivation is inlined into `aria-label`; the reveal control is a shared `Button`. |
| `packages/svforge/templates/dashboard/src/routes/+layout.svelte` | Already native — hidden locale helper links via the `hidden` utility. |
| `packages/svforge/templates/dashboard/src/routes/(app)/+layout.svelte` | Already native — delegates to `AdminLayout`; holds no styling. |
| `packages/svforge/templates/dashboard/src/routes/(app)/admin/+page.svelte` | Already native — `Card`/`Badge`/`Button`; the metric list is derived because it mixes data with locale-reactive labels. |
| `packages/svforge/templates/dashboard/src/routes/(app)/admin/settings/+page.svelte` | Already native — `PageHeader`/`Card`/`Feedback`/`Input`/`Button`; the hand-rolled error strip was already replaced by `Feedback`. |
| `packages/svforge/templates/dashboard/src/routes/(app)/admin/users/+page.svelte` | Already native — `Table`/`AppDialog`/shared primitives; the self-targeted status action is disabled and reads `cursor-not-allowed`; multi-use derived state kept. |
| `packages/svforge/templates/dashboard/src/routes/login/+page.svelte` | Already native — `AuthLayout` + `Input`/`PasswordInput`/`Button`/`Feedback`, real SvelteKit form. |
| `packages/svforge/templates/dashboard/src/routes/setup/+page.svelte` | Already native — same composition as login, with its own action and localized copy. |

### Optional addons (14)

| File | Disposition |
| --- | --- |
| `packages/audit/templates/src/routes/(app)/admin/audit/+page.svelte` | Already native — `Card`/`Table`/`Input`/shared `Button`; the data passthroughs are reused by the table and pagination. |
| `packages/blog/templates/src/routes/blog/+page.svelte` | Already native — `Card`/`Badge` and native anchor cards (the anchor provides the pointer). |
| `packages/blog/templates/src/routes/blog/[slug]/+page.svelte` | Already native — `prose`/`anchor` utilities; the derived component and formatted date are required for rendering and locale. |
| `packages/chat/templates/src/routes/chat/+page.svelte` | Already native — `Card`/`Badge` with anchor list rows. |
| `packages/chat/templates/src/routes/chat/[id]/+page.svelte` | Already native — `Card`/`Textarea`/shared `Button`, real form action. |
| `packages/dnd/templates/src/lib/components/svforge/dnd/SortableList.svelte` | Specialised — `cursor-grab`/`active:cursor-grabbing` express the drag affordance; the drag/drop behaviour belongs to the library. |
| `packages/dnd/templates/src/routes/showcase/dnd/+page.svelte` | Already native — the module demo composes `Card`/`Button`/`SortableList` with layout utilities and localized copy; no custom CSS, fixture data only. |
| `packages/graph/templates/src/lib/components/svforge/graph/KnowledgeGraph.svelte` | Specialised — reviewed inline-style exception: the canvas container needs runtime `width`/`height`, which utilities cannot express. |
| `packages/notifications/templates/src/lib/components/svforge/ui/NotificationsBell.svelte` | Already native — Skeleton `Popover` with a `btn-icon` trigger that declares `cursor-pointer`, `card` radius on the surface, and a shared `Button` for "mark all". |
| `packages/oauth/templates/src/lib/components/svforge/ui/OAuthButtons.svelte` | Already native — native `<button class="btn …">` controls declare `cursor-pointer`/`cursor-not-allowed` conditionally; the addon contract does not guarantee the shared primitive. |
| `packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapEditor.svelte` | Specialised — Tiptap owns the editing surface; only layout utilities and the `prose` content classes. |
| `packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapToolbar.svelte` | Corrected — Skeleton `ToggleGroup`/`Popover`: every formatting control declares `cursor-pointer`, lists/blocks use the shared `Button`, and the native link/cancel triggers declare their affordance. |
| `packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapPreview.svelte` | Specialised — sanitized `{@html}` output inside the `prose` utilities; sanitization lives in `renderTiptap`. |
| `packages/ui_toast/templates/src/lib/components/svforge/ui/Toaster.svelte` | Already native — Skeleton `Toast`; the close trigger declares `cursor-pointer`. |
| `packages/uploads/templates/src/lib/components/svforge/uploads/FileUpload.svelte` | Already native — native file input with `cursor-pointer disabled:cursor-not-allowed`; the presign/POST/PUT contract is untouched. |

## Reviewed exceptions

| Exception | Why utilities cannot express it | Guard |
| --- | --- | --- |
| `KnowledgeGraph.svelte` sets `style="width: {width}; height: {height};"` | The force-graph container sizes itself from consumer-provided runtime values; there is no static utility for arbitrary dynamic dimensions. | The baseline guard test allowlists exactly this file and fails if the inline style disappears (stale exception) or appears anywhere else. |
| Native `<button class="btn …">` in OAuth, Tiptap and the demo page | Those modules do not guarantee the shared `Button` primitive is available (addon capability contract), so the owning file declares the cursor itself. | `tests/native-button-affordance.test.ts` fails when a native `btn`/`btn-icon` button ships without an affordance. |

No scaffolded component ships a `<style>` block.

## Keeping the baseline true

- The audit disposition above is enforced by `tests/skeleton-baseline.test.ts`: every scaffolded `.svelte` file must appear here, no scaffolded template may add a `<style>` block, and inline `style=` is limited to the allowlisted exception.
- Affordance regressions are covered by `tests/native-button-affordance.test.ts` (native `btn`/`btn-icon`), `tests/primitives-cursor-affordance.test.ts` (Checkbox/Switch enabled vs disabled), and the shared-`Button` suites.
- Skeleton-native composition rules (no duplicated `card` radius, no invented size utilities, no parallel palettes) live in `tests/skeleton-native.test.ts`, `tests/skeleton-markup.test.ts` and the `svforge check` design-system rules.
- When adding a scaffolded component, add its row here in the same PR. When auditing a new Skeleton release, re-verify the class vocabulary against the pinned Skeleton version and the shipped theme (`src/lib/styles/svelteforge-theme.css`) before changing a class.
- Verify affordance in a generated app (computed `cursor` and real activation, desktop and mobile), not only by asserting class strings.
