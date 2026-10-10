# Instructions agents — dépôt SvelteForge

Ce fichier concerne les contributions à ce monorepo. **Il ne décrit pas les projets scaffoldés** : leurs conventions sont générées par `packages/svforge/src/scaffolded-agents.ts` dans l’`AGENTS.md` livré au consommateur. Ne confonds pas ces deux publics.

## Produit et architecture

SvelteForge est un boilerplate de démarrage, pas une bibliothèque de composants ni un clone de shadcn/ui. Le template `base` fournit les fondations; les capacités optionnelles restent des modules composables. Avant d’ajouter une fonctionnalité ou un composant, cherche d’abord une implémentation existante dans `templates/*/src/lib/components/svforge/` ou les composants officiels de Skeleton.

- Le registre de composants est organisé en `primitives/`, `ui/`, `layout/`.
- Skeleton est la source par défaut des primitives UI; les projets peuvent choisir explicitement une autre bibliothèque. Respecte toute sélection humaine et réutilise ses composants. N’installe, n’enregistre ou ne remplace jamais une bibliothèque UI, et ne crée pas de primitive générique, sans demande humaine explicite. Les composants plus riches viennent de `@skeletonlabs/skeleton-svelte` par défaut.
- La copy UI statique passe par Paraglide. Toute nouvelle clé doit exister dans les catalogues FR et EN.
- Le CSS global du scaffold est câblé dans `src/routes/layout.css`; le thème Skeleton complet est dans `src/lib/styles/svelteforge-theme.css`. N’ajoute pas de couche générique de tokens/styles sans besoin répété non couvert par Skeleton/Tailwind.
- Svelte 5 runes uniquement; pas de patterns Svelte 4 (`on:click`, `<slot>`, `$app/stores`).

## Propriété de l'écosystème Svelte

- `sv create` possède le bootstrap SvelteKit, les addons `sv add` officiels les intégrations génériques lorsqu'ils satisfont le contrat et se composent réellement, et `sv migrate` les migrations Svelte/Kit. N'ajoute pas de générateur SvelteKit parallèle.
- SVForge possède ses overlays spécifiques : Skeleton, FR/EN et contexte projet, politique d'auth/admin, modules `@svforge/*`, checker et upgrade de ses propres recipes. Ne délègue jamais une frontière de sécurité à une simple page UI.
- Avant une fondation générique, vérifie l'addon publié dans la version de `sv` supportée et teste les fichiers générés et les transformations dans le bon ordre. « Official first » ne signifie pas superposer aveuglément deux addons qui écrivent les mêmes fichiers.
- La matrice d'ownership et les chevauchements sont dans [`packages/svforge/docs/structural-duplication.md`](packages/svforge/docs/structural-duplication.md); la politique et les preuves de compatibilité SvelteKit sont dans [`packages/svforge/docs/sveltekit-compatibility.md`](packages/svforge/docs/sveltekit-compatibility.md). Les promotions de CLI/framework passent par une PR et un pin exact; ne duplique pas les chantiers auth/DB de #547 ni release npm de #549.

## Templates et artefacts générés

Les sources scaffoldées vivent sous `packages/*/templates/`. Le prebuild n’embarque que `templates/*/src/**` et `templates/*/root/**`; les fichiers ailleurs dans un template ne sont pas livrés. Après toute modification de template, exécute le prebuild/build du package pour régénérer les artefacts versionnés. Ne modifie jamais à la main les fichiers marqués AUTO-GENERATED, notamment `packages/*/src/templates.ts`.

## Workflow

- Pour une issue, travaille dans le worktree dédié, à partir de `origin/main` à jour; ne pousse pas sur `main`.
- TDD pour les changements de comportement : test comportemental rouge, implémentation minimale, puis refactor.
- Valide selon le périmètre : `bun run test`, `bun run lint`, `bun run typecheck`, `bun run build:all`, et les profils concernés de `bash scripts/test-scaffold.sh`.
- `CONTRIBUTING.md` donne le processus court; `docs/RELEASE.md` est l’unique procédure de versioning/publication. Pour un changement livré, ajoute normalement un Changeset avec package(s), impact `patch`/`minor`/`major` et résumé utilisateur; aucun format de titre/commit n’est imposé. Les changements docs/tests sans impact publiable peuvent omettre le fichier. Si un addon `@svforge/*` est bumpé, inclure aussi `svforge: patch` pour republier son manifeste de compatibilité exact.
- Avant d’écrire de la documentation, cherche une source existante à réutiliser. Ne crée un document que pour une responsabilité nécessaire et maintenue indépendamment.

## Conventions d’implémentation

- Composants : classes/presets Skeleton et Tailwind, pas de CSS brut; `cn()` et prop `class`; `HTMLAttributes<T>` de `svelte/elements`; `$bindable()` déclaré dans l’interface Props.
- Icônes Phosphor : consomme-les via `$lib/icons`; les imports profonds `phosphor-svelte/lib/*` sont réservés aux définitions dans `src/lib/icons/`.
- Un contrôle de thème partagé utilise `ui/ThemeToggle.svelte`; ne crée pas de contrôle local dupliqué.
- Le checker de design-system est livré avec le scaffold : garde ses règles de structure, primitives et utilitaires alignées sur son inventaire généré.

## Graphify (facultatif)

Si `graphify` est installé, après implémentation et validation exécute `bun run graphify:update` (jamais la commande brute), puis inclus tout diff déterministe de `graphify-out/`. Réexécute après rebase/pull/merge. Si l’outil n’est pas installé, ignore cette étape. Ne modifie pas les hooks Git pour l’activer.
