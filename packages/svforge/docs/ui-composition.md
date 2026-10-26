# Atomic, reusable UI composition

SVForge scaffolds applications out of small, discoverable, single-responsibility components. A composition that has a real, repeated responsibility gets **one discoverable home** and is consumed from there; a page never re-assembles the same markup and behaviour twice. This page records the reuse audit from issue #603, the interactions that are deliberately *not* extracted, and the guards that keep both true.

Related: the styling half of the same baseline (Tailwind/Skeleton only, per-file affordance dispositions) is in [skeleton-baseline.md](skeleton-baseline.md); upstream delegation is in [structural-duplication.md](structural-duplication.md).

## Contract

- **One home per repeated composition.** `primitives/` holds behaviour wrappers of a Skeleton primitive (`Button`, `Input`, `Toggle`…), `ui/` holds product compositions (`AppDialog`, `PasswordInput`, `Card`, `Table`…), `layout/` holds page structure (`Navbar`, `PageHeader`, `AuthLayout`), and domain components stay in the feature/route that owns them.
- **Narrow, typed API.** A shared component exposes the smallest set of props that expresses its responsibility, and keeps behaviour with the library that owns it (Skeleton keeps focus trap/restore, scroll lock, Escape and outside-click policy).
- **The feature keeps its domain.** SvelteKit form actions, permissions, validation, page state and localized copy stay with the route. The shared shell never learns which flow is open.
- **Do not extract** a second component whose only difference is a label, a color or page copy (pass props instead); do not wrap a Skeleton primitive that already does the job; do not split a component into one-line pieces or add a `Page*`/`Section*` variant to freeze a dimension (`PageHeader` is the one canonical page convention).
- **Record, don't mass-refactor.** A candidate that is not a proven, safe consolidation is written down here as a follow-up instead of being rewritten in the same change.

## Consolidated compositions

| Composition | Why it was duplicated | Shared home | What stayed with the consumer |
| --- | --- | --- | --- |
| Application modal shell | The admin users route embedded the full `Dialog / Portal / Backdrop / Positioner / Content / Title / CloseTrigger` composition; every new admin modal would have copied it (#612). | `dashboard/src/lib/components/svforge/ui/AppDialog.svelte` — controlled `open` + `onOpenChange`, `title`, optional `description`, `size` (`sm`/`md`/`lg`), `closeOnInteractOutside`, `closeLabel`, `class`, body snippet. | Users page state, the create/edit/status/invite forms, permissions and copy. |
| Password reveal field | Login and setup hand-rolled the same masked input, eye/eye-slash icons, toggle button and local `passwordVisible` flag (#614). | `dashboard/src/lib/components/svforge/ui/PasswordInput.svelte` — `label`, `name`, bindable `value`, `autocomplete`, `placeholder`, `required`, `disabled`, `error`, `class`. | The form, its validation, the submit action and the localized copy. |
| Page header | Routes re-assembled `flex … justify-between` headers with their own `<h2>` and drifting action rows (#601). | `layout/PageHeader.svelte` — `title`, optional `description`, `actions` snippet. | The action buttons themselves (shared `Button` defaults). |
| Stat cards | `/admin` repeated three near-identical metric cards (#636). | A single `{#each}` over one derived metric list inside the route; `Card` still owns the surface. | The metric values and their labels. |
| Avatar, feedback and table cells | Already single homes before this audit — both admin screens consume `ui/AvatarInitial.svelte` and `ui/Feedback.svelte`, and table cells are rendered through the generic `Table` `children` snippet. Kept as-is rather than re-wrapped. | `ui/AvatarInitial.svelte`, `ui/Feedback.svelte`, `ui/Table.svelte`. | Row data, status semantics, dismissal handlers. |

### Modal shell rules

- Never apply Skeleton's `animate-dialog` to framework `Dialog.Content`: that utility animates a native `<dialog open>`, while `Dialog.Content` is a `div[data-state]`, so the panel stays transparent behind a dimmed backdrop.
- Form/confirmation modals keep `closeOnInteractOutside={false}` (an outside click never discards an open form); dismissal is explicit (Escape, close control, Cancel).
- The mobile navigation drawer is **not** the modal shell: it owns its own geometry and closes on outside interaction. Do not force it through `AppDialog`.

## Audited and deliberately not extracted

| Candidate | Evidence | Disposition |
| --- | --- | --- |
| Empty/zero-state card | Four copies of `<Card variant="outlined">` with centred muted text: audit, chat list and chat thread use `p-8`, the users page uses `py-8`. | **Follow-up candidate.** The drift proves it is copy-paste, but an `EmptyState` component would add a public `ui/` surface (plus guidance, catalogue, messages and a Changeset) for one line of markup. Revisit if a fifth consumer appears or an empty state needs an action/illustration slot. |
| Field id / `errorId` / `hasError` / `aria-describedby` derivation | The same four derivations live in `primitives/Input.svelte`, `Select.svelte` and `Textarea.svelte`. | **Accepted duplication.** The `$props.id()` + `aria-describedby` join is the SSR-stable accessibility contract and is documented inline per primitive; a helper would hide `$props.id()` from the call site where Svelte requires it. Revisit only with a fourth field primitive. |
| `Feedback` vs `Alert` | Both render a tonal preset container with an icon; `Feedback` adds `role="alert"/"status"` and a dismiss control. | **Accepted.** Different responsibilities (transient status vs static content block); merging would force a feature component into the generic `Alert`. |
| Mobile drawer vs application modal | `layout/AdminLayout.svelte` keeps its Dialog composition. | **Accepted.** Different interaction pattern (navigation, outside-click dismissal, full-height geometry). Guarded so it cannot silently become a modal copy. |
| Locale helper switcher | The hidden `{#each locales}` link block exists in both the base and dashboard root `+layout.svelte`. | **Accepted.** The dashboard template replaces the base root layout; this is template-mode overlay, not route-level duplication. |
| Popover surface (notifications bell, Tiptap link editor) | Both compose `Popover + Portal + card` content. | **Accepted.** The trigger contracts, content and behaviour differ; only surface classes overlap. |
| Users CRUD forms (create/edit/status/invite) | Four `method="POST"` forms inside `AppDialog`. | **Accepted.** Domain forms with different fields, actions and permissions stay with the route. |

## Guards and verification

- `tests/app-dialog.test.ts` — the shell's API and rendering (accessible title/description, `card` surface without `animate-dialog`, size presets, Escape and close control, close label, touch-sized close, barrel export), plus composition guards: no scaffolded **route** composes Skeleton `Dialog`/`Portal`, no template applies `animate-dialog`, and the drawer keeps its own dismissal policy.
- `tests/password-input.test.ts` — the shared field's masked/reveal behaviour, forwarded `autocomplete`, disabled state, and a reuse guard proving login/setup compose it without a local `passwordVisible` flag.
- `dashboard/src/e2e/users-dialog.test.ts` — in a generated application: modal semantics and focus trap, Escape with focus restore, non-zero geometry with `opacity ≥ 0.99` and a hit-testable panel above the backdrop (`document.elementFromPoint`), input interaction, outside click **not** discarding a form, the create/edit/invite/status flows, and a 390×844 viewport pass including the drawer's outside-click dismissal.
- `svforge check` keeps flagging hand-styled primitives and duplicated Skeleton compositions in generated projects.

## Adding a repeated composition

1. Prove the duplication: at least two consumers with the same structure and behaviour (not merely the same label).
2. Put it in the lowest directory that expresses its responsibility, with a narrow typed API and Skeleton preserving the interaction.
3. Keep domain logic, forms, permissions and copy with the feature.
4. Add behaviour-focused regressions (jsdom for the contract, Playwright for rendered geometry/focus/dismissal when the composition is modal or drawer-like) and a reuse guard for the consumers you migrated.
5. Update the scaffolded guidance (`AGENTS.md` component contract and the `llms.txt` component map) in the same change, and record here what was consolidated or deliberately left alone.
