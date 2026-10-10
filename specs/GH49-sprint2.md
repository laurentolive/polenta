# GH49 — Sprint 2 : textes, thème, logo, AGENTS.md (dernier sprint)

Spec : [GH49.md](GH49.md) — Design : [GH49-design.md](GH49-design.md) — Tests : [GH49-tests.md](GH49-tests.md)
— Sprint 1 : [GH49-sprint1.md](GH49-sprint1.md)

## Décision prise avant le sprint

Point ouvert du sprint 1 (repo public) : **les marques client sont commitées dans ce repo, avec
l'accord explicite et écrit du client** pour apparaître publiquement — règle écrite en tête de
`apps/desktop/brands/README.md`, accord à mentionner dans le message de commit qui ajoute la marque.

## Comportement implémenté

- **Textes UI** : `{{appName}}` (variable globale i18next `defaultVariables`, = `BRAND.productName`)
  remplace « Polenta » dans les 9 chaînes FR et EN (accueil, connexion, projet de démo, « pas un
  projet… », classeur d'exécution, notification de mise à jour, dossier d'exemples).
  `useWorkspaceStructure.ts` : ses deux messages en dur passent en i18n (`workspace.unknownDirectory`,
  `workspace.notAWorkspace`).
- **Messages et fichiers générés côté main** : erreur « Not a <productName> project », message de
  compte absent (`workspace-tree.service.ts`), auteur du commit d'init `<productName> <<id>@localhost>`,
  identité par défaut `<productName> User`, dossier `Exemples <productName>`, auteur des classeurs
  Excel exportés, description du tool MCP `get_schema`.
- **AGENTS.md** : `buildAgentsMdTemplate(brand)` — produit présenté sous `productName`, lien
  `website` s'il existe (Demo Specs : sans lien) ; `.polenta/`, `polenta-repo.yaml`, `POLENTA_USER`
  cités tels quels.
- **Couleurs** : `theme` de `brand.yaml` injecté par le plugin Vite dans `index.html` en
  `<style id="brand-theme">` (`html:root` / `html.dark`). Un token surchargé pour un seul thème
  garde dans l'autre sa valeur de `theme.config.ts`. Polenta : aucune règle ajoutée.
- **Logo** : module virtuel `virtual:brand-logo` (data: URI ou `null`) ; `BrandLogo` au-dessus
  des écrans d'accueil et de connexion ; rien sans `logo.svg` (Polenta).
- **Page des notes de version** : `app:open-release-page` n'ouvre que les pages sous
  `BRAND.releasesUrl` (avant : `laurentolive/polenta` en dur — le lien ne marchait pour aucune
  autre marque).
- **Scan « aucun Polenta visible »** dans `check-gh49.ts` (S1–S3) ; `check-gh34.ts` /
  `check-gh36.ts` importent `register-brand` (services lisant `BRAND`) et `check-gh34` utilise
  `EXAMPLES_FOLDER` au lieu de « Exemples Polenta » en dur.
- `brands/README.md` : format d'une marque, règle d'accord client, commandes de build.

## Fichiers

| Fichier | Modification |
|---------|--------------|
| `apps/desktop/brands/README.md` | nouveau |
| `apps/desktop/scripts/vite-brand-plugin.ts` | thème (`brandThemeCss`), module virtuel du logo |
| `apps/desktop/src/renderer/brand-virtual.d.ts`, `components/BrandLogo.tsx` | nouveaux |
| `apps/desktop/src/renderer/routes/index.tsx`, `routes/login.tsx` | `<BrandLogo />` |
| `apps/desktop/src/renderer/i18n/index.ts`, `locales/fr.json`, `locales/en.json` | `{{appName}}`, 2 nouvelles clés `workspace.*` |
| `apps/desktop/src/renderer/hooks/useWorkspaceStructure.ts` | messages en i18n |
| `apps/desktop/src/main/services/agents-md.template.ts` | `buildAgentsMdTemplate(brand)` |
| `apps/desktop/src/main/services/workspace.service.ts`, `workspace-tree.service.ts`, `auth.service.ts`, `export-template-library.ts`, `export/campaign-execution.xlsx.ts` | nom de la marque |
| `apps/desktop/src/main/ipc/index.ts` | garde de `app:open-release-page` sur `BRAND.releasesUrl` |
| `apps/desktop/src/mcp-server/tools/schema.tools.ts` | description de `get_schema` |
| `apps/desktop/scripts/check-gh49.ts`, `check-gh34.ts`, `check-gh36.ts` | voir ci-dessus |
| `specs/SPEC-*.md`, `specs/SPEC-INDEX.md`, `specs/GH49-tests.md` | voir « Mises à jour SPEC » |

## Divergences par rapport au design

- **Thème injecté dans `index.html`** (balise `<style>`, sélecteurs `html:root` / `html.dark` plus
  spécifiques que ceux d'`index.css`) au lieu d'un module CSS virtuel importé par `main.tsx` :
  l'ordre des feuilles n'importe plus, et rien à modifier dans `main.tsx`.
- **Logo en data: URI** (module virtuel) plutôt qu'un asset `?url` : rien à émettre, SVG de
  quelques centaines d'octets.
- **`AGENTS_MD_TEMPLATE_VERSION` laissée à 3** (le design prévoyait 4) : pour Polenta le texte est
  identique, une montée de version aurait réécrit `AGENTS.md` dans tous les projets existants
  (notes utilisateur perdues, fichier modifié à commiter) pour rien. Un projet garde le nom de la
  marque qui a écrit son `AGENTS.md` (le marqueur ne compare pas le nom).
- **Garde de `app:open-release-page`** sur la marque : non prévu au design, bug trouvé en revue.
- **Description du tool MCP `get_schema`** à la marque : non listée au design, trouvée par le scan.

## Revue de code — points écartés

- Message « Erreur de parsing dans … » encore en français dans `useWorkspaceStructure.ts`, et
  message d'accès distant de `workspace-tree.service.ts` non traduit : antérieurs à GH49, hors
  périmètre (pas de « Polenta » dedans) — candidats pour un ticket i18n.
- `productName` / `website` non échappés dans le lien Markdown d'AGENTS.md (crochets,
  parenthèses) : cas improbable pour un nom de produit ; à reprendre si une marque en a besoin.
- Un projet ouvert par deux marques garde le nom de la première : comportement assumé (spec §6).

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| `SPEC-TECH-stack.md` §9 | nouvelle ligne « Marque (GH49) » ; installeur et `electron-builder.config.ts` + `scripts/package.ts` ; dossier d'installation `<executableName>` ; CI manuelle par marque ; mise à jour par marque ; userData nommé d'après `productName` |
| `SPEC-TECH-stack.md` §10 | variable `POLENTA_BRAND` (build uniquement) |
| `SPEC-I18N.md` §2 | variable globale `{{appName}}`, interdiction de « Polenta » en dur, scan check-gh49 |
| `SPEC-ELECTRON-DESKTOP.md` §2 | arbre : `electron-builder.config.ts`, `brands/`, scripts de marque, `src/shared/` |
| `SPEC-ELECTRON-DESKTOP.md` §19.1 | badge de mise à jour au nom de la marque ; titre de fenêtre `<productName> v<version> — …`, `<title>`/favicon injectés au build |
| `SPEC-MCP-SERVER.md` §2.1, §2.4, §5.1 | `dev-entry.ts --brand` ; bundle avec marque figée, contrôle de cohérence au packaging ; lancement dev ; AGENTS.md à la marque, version 3 conservée |
| `SPEC-INDEX.md` | colonne MAJ → GH49 et mots-clés (marque, brand, white-label, POLENTA_BRAND, appName…) sur les 5 lignes concernées |

## Tests

- `check-gh49.ts` : **52 ok, 0 échec** (sprint 1 + L5, D4, S1–S3).
- `check-gh34.ts` 118 PASS (marques polenta **et** demo), `check-gh36.ts` 67 PASS ; `tsc --noEmit`
  sans erreur ; parité des clés FR/EN vérifiée (aucune orpheline).
- Vérification visuelle (app construite lancée via Playwright/Electron) :
  - **Demo Specs**, écran de connexion : logo, « Bienvenue dans Demo Specs », titre de fenêtre
    « Demo Specs », bouton primaire orange en clair, orange clair en sombre, le reste du thème
    inchangé.
  - **Polenta**, accueil : « Discover Polenta with the demo project », pas de logo, thème d'origine.
  - Effet de bord : le lancement de la marque demo a créé son dossier de données
    `%APPDATA%\Demo Specs` sur ce poste (supprimable).

## Comment tester manuellement

Scénarios `Manuel` de [GH49-tests.md](GH49-tests.md) §3–§5, en particulier :

1. `POLENTA_BRAND=demo pnpm --filter @polenta/desktop dev` — D1–D5 (textes FR/EN, logo, couleurs
   clair/sombre, pas de case de mise à jour, `Exemples Demo Specs/`), D7 (créer un projet :
   `AGENTS.md` « géré avec Demo Specs »), D8 (export Excel : auteur « Demo Specs »).
2. `pnpm --filter @polenta/desktop dev` — N2, N4 : Polenta identique, `AGENTS.md` d'un projet
   existant non réécrit (L3).
3. `POLENTA_BRAND=demo pnpm --filter @polenta/desktop package` puis installation — P4, L1 (Polenta
   et Demo Specs côte à côte).

## Fin de ticket

Dernier sprint : après validation, merge de `GH49` vers `main`, suppression du worktree
`../polenta-official-GH49`, fermeture de l'issue #49.
