# AGENTS.md — SvelteForge

Guide pour agents travaillant sur ce repo. **Positionnement d'abord** : tout le reste en découle.

## Positionnement (source de vérité)

SvelteForge est un **boilerplate de démarrage**, PAS une bibliothèque de composants et PAS un clone de shadcn/ui.

- Le template `base` fournit **uniquement les bases** : boutons, inputs, selects, cards, badges, table + l'infra (theme, SEO, layouts, dark mode).
- **Structure canonique des composants (#242)** : `templates/*/src/lib/components/svforge/` est découpé en `primitives/` (briques simples : Button, Input, Badge…), `ui/` (composés : Card, Alert, Table…), `layout/` (structure de page : Navbar, Footer). C'est le premier registry : un agent cherche là AVANT de créer un composant.
- **i18n Paraglide FR/EN (#239)** : le base scaffoldé embarque Paraglide (compiler-first, baseLocale fr) + `messages/{fr,en}.json`. Toute copy UI statique passe par `m.*` ; toute clé ajoutée doit exister en FR **et** EN (parité testée). Les modules fusionnent leurs messages dans les catalogues du projet sans écraser.
- **Design-system harness (#240, #480)** : Skeleton est la stratégie UI **par défaut**, mais une bibliothèque UI/headless explicitement choisie par l'utilisateur peut être enregistrée dans `.svforge.json`. `svforge check` et ESLint détectent les erreurs vérifiables (primitives dupliquées, classes inexistantes), et **non** la simple présence d'un second kit. L'agent n'ajoute jamais de bibliothèque de lui-même.
- **CSS Skeleton-first (#313)** : `src/routes/layout.css` est l'unique point d'entrée CSS global et reste du wiring ; `src/lib/styles/svelteforge-theme.css` est le thème Skeleton v5 complet et la source de vérité visuelle. Le boilerplate ne précrée ni `tokens.css` ni `index.css` générique.
- **Composition & presets (#236)** : 2 templates (`base`/`dashboard`) + modules opt-in. Les presets (`svforge preset saas|community`) sont des recettes `sv add` — jamais de duplication de code module. Le contrat de métadonnées (`svforge-modules.json` + `MODULES`/`PRESETS` TS) documente id/description/requires/optional/files.
- Pour tout composant plus riche (accordion, tabs, avatar, tooltip, dialog…), on **n'écrit pas** de composant svforge — on utilise directement les composants officiels de `@skeletonlabs/skeleton-svelte`.
- Les modules sont **composables et opt-in** : l'utilisateur choisit 2-3 modules selon ses besoins.
- Le vrai cœur du métier : **vitesse de démarrage**. Un `sv create` + `sv add` = projet production-ready.

Conséquence : avant d'ajouter quoi que ce soit au base, se demander « est-ce une base ? » (→ issue #199 pour le trim en cours).

## Contrat UI des agents : réutiliser avant d'inventer (#480)

**Liberté du développeur ≠ autonomie de l'agent.** Le propriétaire d'un projet peut installer Zag, Bits UI, shadcn-svelte ou toute autre bibliothèque et la déclarer dans `.svforge.json`. Ce choix n'est pas une erreur. Sans demande explicite, l'agent ne change pas la stratégie UI.

Avant de produire une interface, l'agent DOIT :

1. Chercher le composant voulu dans le code du projet et le catalogue SVForge (`primitives/`, `ui/`, `layout/`).
2. **Réutiliser** le composant et ses props/variantes : un bouton différent n'autorise pas un autre `Button.svelte`, `FancyButton.svelte` ou `CustomButton.svelte`.
3. Réutiliser les primitives Skeleton ou celles d'une bibliothèque **déjà déclarée par l'utilisateur**. Ne pas installer/enregistrer une nouvelle UI library sans demande explicite.
4. Utiliser uniquement des utilitaires Tailwind et classes/presets Skeleton existants et vérifiés. Ne pas inventer de classes CSS, presets, tokens ou overrides pour contourner le design system.
5. Étendre une variante ou un composant partagé plutôt que dupliquer. Ne créer un **composant métier distinct** que si les briques réutilisables ne couvrent pas le besoin.
6. Demander une décision de l'utilisateur avant de changer le kit UI, ajouter une primitive générique ou autoriser une exception de style. Ne pas désactiver les checkers pour satisfaire la demande.

**Vérifications :** maintenir `svforge check` et le lint Tailwind/Skeleton stricts pour les duplications et classes invalides. Ces outils ne peuvent pas déterminer si l'auteur est humain ou IA : les choix explicites du projet sont consignés dans sa configuration, et `AGENTS.md` contraint l'agent.

**Scripts et documentation :** avant de créer un nouveau fichier, chercher un script ou document existant de même responsabilité. Le réutiliser ou l'étendre ; ne pas multiplier les variantes de confort.

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

# Scaffold réel et validations (le même chemin que CI) :
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

- **Skeleton par défaut dans les templates** : réutiliser les composants existants, les classes/presets Skeleton et les utilitaires Tailwind valides. Le projet utilisateur peut adopter une autre bibliothèque sur choix humain explicite ; l'agent doit respecter ce choix, pas le faire à sa place.
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
