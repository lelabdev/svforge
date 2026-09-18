# AGENTS.md — SvelteForge

Guide pour agents travaillant sur ce repo. **Positionnement d'abord** : tout le reste en découle.

## Positionnement (source de vérité)

SvelteForge est un **boilerplate de démarrage**, PAS une bibliothèque de composants et PAS un clone de shadcn/ui.

- Le template `base` fournit **uniquement les bases** : boutons, inputs, selects, cards, badges, table + l'infra (theme, SEO, layouts, dark mode).
- **Structure canonique des composants (#242)** : `templates/*/src/lib/components/svforge/` est découpé en `primitives/` (briques simples : Button, Input, Badge…), `ui/` (composés : Card, Alert, Table…), `layout/` (structure de page : Navbar, Footer). C'est le premier registry : un agent cherche là AVANT de créer un composant.
- **i18n Paraglide FR/EN (#239)** : le base scaffoldé embarque Paraglide (compiler-first, baseLocale fr) + `messages/{fr,en}.json`. Toute copy UI statique passe par `m.*` ; toute clé ajoutée doit exister en FR **et** EN (parité testée). Les modules fusionnent leurs messages dans les catalogues du projet sans écraser.
- **Design-system harness (#240)** : Skeleton est l'unique source de primitives ; SvelteForge fournit les patterns de composition (`primitives/ui/layout`). Un catalogue machine-readable (`svforge-catalog.json`) est livré au projet + `npx svforge check` (ERROR bloquant : second UI kit, primitive dupliquée ; WARN : valeurs arbitraires). CI le vérifie sur chaque scaffold. Le changement de thème applicatif réutilise toujours `ui/ThemeToggle.svelte`, jamais un contrôle local.
- **CSS Skeleton-first (#313)** : `src/routes/layout.css` est l'unique point d'entrée CSS global et reste du wiring ; `src/lib/styles/svelteforge-theme.css` est le thème Skeleton v5 complet et la source de vérité visuelle. Le boilerplate ne précrée ni `tokens.css` ni `index.css` générique.
- **Composition & presets (#236)** : 2 templates (`base`/`dashboard`) + modules opt-in. Les presets (`svforge preset saas|community`) sont des recettes `sv add` — jamais de duplication de code module. Le contrat de métadonnées (`svforge-modules.json` + `MODULES`/`PRESETS` TS) documente id/description/requires/optional/files.
- Pour tout composant plus riche (accordion, tabs, avatar, tooltip, dialog…), on **n'écrit pas** de composant svforge — on utilise directement les composants officiels de `@skeletonlabs/skeleton-svelte`.
- Les modules sont **composables et opt-in** : l'utilisateur choisit 2-3 modules selon ses besoins.
- Le vrai cœur du métier : **vitesse de démarrage**. Un `sv create` + `sv add` = projet production-ready.

Conséquence : avant d'ajouter quoi que ce soit au base, se demander « est-ce une base ? » (→ issue #199 pour le trim en cours).

## Architecture

Monorepo Bun workspaces. Modèle shadcn : **les sources sont copiées** dans le projet cible via `sv add`, pas importées depuis node_modules.

```
packages/
├── svforge/              ← addon principal — 2 templates
│   ├── templates/base/       ← UI kit de base + infra (skeleton, theme, seo)
│   ├── templates/dashboard/  ← overlay : base + Better Auth + Drizzle + admin
│   ├── src/index.ts          ← defineAddon(), deps scaffoldées, patch vite.config.ts
│   ├── src/modes/            ← base.ts / dashboard.ts : écrit les fichiers via sv.file()
│   ├── src/templates.ts      ← AUTO-GÉNÉRÉ par prebuild — NE JAMAIS ÉDITER À LA MAIN
│   ├── src/doctor.ts         ← diagnostics read-only (#178)
│   ├── src/upgrade.ts        ← upgrade explicite des modules (#179, partiel : #189)
│   └── scripts/prebuild.ts   ← embarque templates/*/src/** en strings dans templates.ts
├── ui_toast/ dnd/ tiptap/ graph/ email/ oauth/ uploads/ blog/  ← modules indépendants
│   └── (même structure : templates/src/** + src/templates.ts auto-généré + scripts/prebuild.ts)
├── scripts/prebuild-utils.ts   ← readDirRecursively (tri déterministe) — partagé
├── scripts/test-scaffold.sh    ← scaffold réel : sv create + sv add + build (utilisé par #191)
├── tests/                      ← vitest racine (bun run test)
└── docs/ (dans packages/svforge) — dumps llms-*.txt (Skeleton v5, Svelte 5) — régénérer via `bash packages/svforge/scripts/fetch-llms-docs.sh` (fraîcheur vérifiée par `tests/llms-docs-freshness.test.ts`)
```

### ⚠️ LE gotcha du repo : le prebuild n'embarque que `src/**` et `root/**`

`prebuild.ts` fait `readDirRecursively(templates/{base,dashboard}/src)` plus `templates/{base,dashboard}/root` pour les fichiers à écrire à la RACINE du projet scaffoldé (`drizzle.config.ts`, `eslint.config.js`, `messages/`, `project.inlang/`, `svforge-catalog.json`, `static/...`). **Tout fichier posé ailleurs dans le template (racine, `static/`, `scripts/`) n'est jamais livré au scaffold** — silencieusement. Deux règles :

1. Un template file doit vivre sous `templates/*/src/**` (ou `templates/*/root/**` si destination = racine du projet).
2. Après TOUTE modification d'un fichier de `templates/`, relancer le prebuild du package (`bun run prebuild` ou `bun run build`) pour régénérer `src/templates.ts` — sinon le scaffold livre l'ancienne version embarquée.

## Workflow

```bash
bun install
bun run build          # build svforge (prebuild + tsdown)
bun run build:all      # build tous les packages
bun run test           # vitest racine (tests/)

# Tester un template localement (sans npm) :
cd packages/svforge && bun run build && bun scripts/test-local.ts base /tmp/sf-test
cd /tmp/sf-test && bun install && bun dev

# Scaffold complet réel (le test de vérité) :
bash scripts/test-scaffold.sh base      # ou dashboard
```

**TDD obligatoire** (voir CONTRIBUTING.md) : Red (test qui échoue pour la bonne raison) → Green → Refactor. Les tests "existence-only" (grep du source) ne comptent pas comme couverture — écrire des tests comportementaux (appel de fonction, fichier généré réel). Cf. #101, #191.

## Graphify knowledge graph (optional)

`graphify-out/graph.json` and `manifest.json` are committed as an **optional shared aid**: every clone/worktree starts from an existing graph. The committed graph simply reflects the latest contributor who chose to update it — it is not guaranteed fresh and CI does not check it. Only the files maintained by the deterministic local workflow are tracked; rendered reports (`GRAPH_REPORT.md`, `graph.html`, labels, cache, backups) stay gitignored.

**If `graphify` is installed** (package `graphifyy` on PyPI, executable `graphify`), run after implementation and validation, and again after any rebase, pull or merge:

```bash
bun run graphify:update   # graphify update . --no-cluster + portability normalize
git status --short
```

Always use `bun run graphify:update` (never raw `graphify update .`): the normalizer step removes machine-local timestamps and absolute-path-derived ids — without it the committed graph would not be portable across machines and worktrees.

Include any resulting `graphify-out/` diff in your PR. **If `graphify` is not installed, skip it** — it is never a requirement, CI never installs or runs it, and nothing fails without it.

**Hook (optional)** — committing `.githooks/pre-commit` does NOT activate it by itself; opt in per clone/worktree with:

```bash
git config core.hooksPath .githooks
```

When activated AND graphify is installed, the hook updates the graph in each commit and refuses commits with unstaged or untracked source changes (the graph must describe exactly the code in the commit). Without graphify it exits 0 and the commit proceeds untouched.

## Testing profiles du template dashboard (#180/#181)

- Défaut : **Vitest** (baseline auth + admin, `bun run test` dans le projet scaffoldé)
- Opt-in : **Playwright** (`test:e2e`), syntaxe : `svforge=template:dashboard+testing:playwright`
- Le profil filtre les fichiers e2e/playwright au scaffold — connus cassés (#186)

## Versions & état actuel

- **Skeleton v5** (`@skeletonlabs/skeleton@5.0.0` en plage majeure épinglée) : le thème custom est au format v5 complet (#194) et sert de source de vérité visuelle.
- **SvelteKit 2.6x / vite-plugin-svelte 7 / vite 8** : les nouveaux projets `sv create` n'ont **plus de `svelte.config.js`** (config dans `vite.config.ts`). Tout patch de `svelte.config.js` est un no-op (cf. blog, #185).
- Svelte 5 runes partout. Pas de patterns Svelte 4 (`on:click`, `<slot`, `$app/stores` → `$app/state`, #196).

## Conventions composants (templates)

- **Skeleton uniquement** : les composants wrappent des classes/presets Skeleton + Tailwind, jamais de CSS brut
- Classes Skeleton valides : `btn`, `input`, `select`, `textarea`, `checkbox`, `badge`, `card`, et presets `preset-filled-*`, `preset-tonal-*`, `preset-outlined-*` (+ suffixes couleurs `-primary-500`, `-surface-400-600`…). **`variant-*` et `preset-ghost` N'EXISTENT PAS en v5** — `variant-*` est l'ancien nommage Skeleton v2, renommé `preset-*` en v3.
- **CSS global minimal** : `templates/base/src/routes/layout.css` charge les outils et importe directement `src/lib/styles/svelteforge-theme.css`. Pas de `tokens.css`/`index.css` générique dans le scaffold.
- **Theme Skeleton comme source de vérité** : palettes, surfaces, brand, root backgrounds, typo, radius/shapes, borders/rings/outlines restent dans `[data-theme='svelteForge']` dans `svelteforge-theme.css`. Les surfaces partagées suivent le thème avec des tokens appariés (`bg-surface-50-950`, `text-surface-950-50`, `border-surface-200-800`) ; les éléments volontairement propres à un mode restent permis.
- **Layout/whitespace** : utiliser les utilities Tailwind standard (`p-4`, `gap-6`, `max-w-7xl`, etc.). Ne pas créer de couche de tokens globale avant qu'un vrai besoin produit répété et non couvert par Skeleton/Tailwind existe.
- **`cn()` + prop `class`** sur chaque composant (merge/override)
- **`HTMLAttributes<T>`** de `svelte/elements` pour étendre les attributs natifs (`HTMLDivAttributes` n'existe pas)
- **`$bindable()`** déclaré dans l'interface Props, pas juste déstructuré
- **Phosphor** : `import X from 'phosphor-svelte/lib/IconName'` (pas de sous-dossier `icons/`, pas d'extension)

## Git

- Issues et branches : suivre `CONTRIBUTING.md`. Branche = `N-slug` depuis
  `main`. Jamais de commit direct sur `main`.
- Commits = saves, sans cérémonie. Squash merge uniquement (via PR).
- Toujours partir de `origin/main` à jour (`git fetch` — le main local peut être en retard).

## Clôture de roadmap

- **Preuve canary** : quand une roadmap coche « canary ecosystem vert », le run
  cité doit être **postérieur au dernier commit du lot** (`head_sha` du run ≥
  dernier commit). Un vieux canary vert dans l'historique ne valide pas un HEAD
  plus récent — rejouer `gh workflow run canary.yml --ref main` avant de
  clôturer, et noter le SHA testé dans le commentaire de clôture. Le canary
  hebdo reste un détecteur de drift `latest`, jamais un blocage par PR.

## Pièges connus (vérifiés)

- `sv create` avec plugins : syntaxe explicite `'tailwindcss=plugins:typography,forms'`
- `HTMLAttributes<HTMLImageElement>` n'inclut pas `src`/`alt` — les définir explicitement dans Props
- Réponses d'actions SvelteKit en JSON : `{ type, data }` — le message est à `result.data.message`, pas `result.message` (#188)
- Les messages d'erreur des catch : fallback générique, pas `e.message` brut exposé à l'UI (#188)
- Les dumps `packages/svforge/docs/llms-*.txt` servent de référence hors-ligne (Skeleton v5 + Svelte 5/Kit 2). Si le test de fraîcheur échoue (dump > 190 jours) : `bash packages/svforge/scripts/fetch-llms-docs.sh` puis committer le résultat

## Point d'entrée docs

- README.md — positionnement + usage
- CONTRIBUTING.md — setup + TDD
- packages/svforge/AGENTS.md — spécificités du package svforge (templates, modes)

## Utiliser svforge pour un nouveau projet — la règle, puis la procédure

**svforge est le RÉFLEXE, pas une option.** Pour tout nouveau projet SvelteKit — même un POC, même
un petit chat — le geste par défaut est `sv add svforge`, pas une installation manuelle de
Skeleton + Tailwind + `cn()` + thème.

Les trois arguments déjà rejetés (juin 2026, épicerie-chef) :

| Argument | Pourquoi il est faux |
|---|---|
| « c'est trop pour un petit projet » | le tree-shaking retire les composants inutilisés au build : des fichiers non utilisés ne coûtent rien |
| « on veut nos propres couleurs » | le thème svforge est un **point de départ** : on le remplace par son propre thème oklch, pour le même effort, mais en partant d'un setup qui marche |
| « on a besoin d'un seul bouton » | c'est un argument POUR : un `Button.svelte` à variantes vaut mieux que des classes Tailwind brutes dans le markup |

Coût réel de ne pas l'utiliser : 30+ minutes de boilerplate à chaque projet (Skeleton, `cn()`, imports
CSS, système de thème, wrappers de composants).

Projet existant créé sans svforge : l'ajouter tôt avec `npx sv add svforge` (recopie composants, CSS et
thème). S'il est trop tard (CSS, composants et thème déjà custom), ne pas forcer la migration.

### Règles non négociables

- Template de base **lean** : pas de toast, pas de modal, pas de composant optionnel. Chaque module est
  un package séparé (`packages/<name>/`).
- Nommage npm : **underscore** pour l'UI atomique (`@svforge/ui_toast`), pas de séparateur pour les
  modules complexes (`@svforge/dnd`, `@svforge/charts`).
- Chaque module est un vrai addon avec son build et son `defineAddon()` ; la base ne porte pas les
  dépendances des modules.
- **Jamais de publication sans le go explicite de Ludo** : pas de bump, pas de `npm publish`, pas de push.

### Avant de demander à publier

Le pipeline complet est dans `docs/RELEASE.md`. Exigence à ne pas contourner : un **vrai `sv create`**
(celui que Ludo tape) doit passer de bout en bout —

```bash
cd /tmp && rm -rf sf-test-real
bunx sv create sf-test-real --template minimal --types ts --add 'svforge=template:base' --install bun --no-download-check
cd sf-test-real && bun dev --host --port 5178
# attendu : aucun message PostCSS, data-theme="svelteForge" présent, 200 sur toutes les pages
```

Après tout changement majeur, vérifier aussi `llms.txt` (liste des composants, templates, stack) et
`README.md`, qui peut être très en retard après une refonte.
