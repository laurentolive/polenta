# GH49 — Design : marque blanche (nom, icône, logo, couleurs par marque au build)

Spec : [GH49.md](GH49.md) — Issue : [#49](https://github.com/laurentolive/polenta/issues/49)

## 1. Vue d'ensemble

Une **marque** = un dossier `apps/desktop/brands/<id>/` (`brand.yaml` + icônes + logo optionnel).
Un seul module Node, `scripts/brand.ts`, lit et valide la marque désignée par `POLENTA_BRAND`
(défaut `polenta`). Ce module est utilisé **uniquement au build** (et par les points d'entrée
`tsx`) ; il produit un objet `BrandInfo` qui est :

```
brands/<id>/brand.yaml ──► scripts/brand.ts : loadBrand()
                              │
     ┌────────────────────────┼──────────────────────────┬──────────────────────────┐
     ▼                        ▼                          ▼                          ▼
electron.vite.config.ts   scripts/package.ts         build:mcp-server            scripts/register-brand.ts
 define __POLENTA_BRAND__  electron-builder API        (scripts/build-mcp-server.ts) (tsx : check-*.ts,
 (main, preload, renderer) (appId, productName,        esbuild --define             serveur MCP en dev)
 + plugin Vite brand       icônes, publish, nsis…)     __POLENTA_BRAND__            globalThis.__POLENTA_BRAND__
 (thème, logo, title,
  favicon)
                              ▼
                 src/shared/brand.ts : export const BRAND  ← seul point de lecture dans le code applicatif
```

Le code applicatif (main, preload, renderer, serveur MCP) ne lit **jamais** `brand.yaml` ni
`POLENTA_BRAND` : il importe `BRAND` depuis `src/shared/brand.ts`, constante figée au build.

## 2. Fichiers à créer / modifier

### 2.1 Marques

| Fichier | Contenu |
|---------|---------|
| `apps/desktop/brands/polenta/brand.yaml` | `id: polenta`, `productName: Polenta`, `appId: com.polenta.desktop`, `executableName: polenta`, `website: https://polenta.dev`, `update: { provider: github, owner: laurentolive, repo: polenta }`, pas de `theme` |
| `apps/desktop/brands/polenta/icon.{ico,png,svg}`, `icon-256.png` | **déplacés** (`git mv`) depuis `apps/desktop/build/` ; `src/renderer/public/icon.svg` (favicon, **différent** de `build/icon.svg`) déplacé en `brands/polenta/favicon.svg` — le plugin (§2.4) utilise `favicon.svg` s'il existe, sinon `icon.svg` |
| `apps/desktop/brands/demo/…` | marque de test : `productName: Demo Specs`, `appId: com.example.demospecs`, `executableName: demo-specs`, pas de `update`, `theme` (prim clair/sombre distincts), `logo.svg`, icônes distinctes (simple pastille de couleur) |
| `apps/desktop/brands/README.md` | format de `brand.yaml`, tokens surchargeables, commande de build d'une marque |

### 2.2 Chargement de la marque (build)

**`apps/desktop/src/shared/brand-types.ts`** (nouveau, sans dépendance) :

```ts
export type BrandUpdate =
  | { provider: 'github'; owner: string; repo: string }
  | { provider: 'generic'; url: string; releasesUrl?: string }

/** Ce qui est figé dans le binaire — sérialisable JSON (define). */
export interface BrandInfo {
  id: string              // [a-z0-9-]+, = nom du dossier
  productName: string
  appId: string
  executableName: string  // défaut : id
  website?: string
  update?: BrandUpdate    // absent → auto-update désactivé
  releasesUrl?: string    // dérivé : github → https://github.com/<owner>/<repo>/releases ; generic → update.releasesUrl
  keytarService: string   // dérivé : = id (Polenta → 'polenta', inchangé)
  hasLogo: boolean
}

export type BrandTheme = Partial<Record<string, { light?: string; dark?: string }>>
```

**`apps/desktop/scripts/brand.ts`** (nouveau, Node : `fs`, `js-yaml`) :

```ts
export function resolveBrandId(env = process.env): string          // POLENTA_BRAND ?? 'polenta'
export function brandDir(id: string): string                       // apps/desktop/brands/<id>
export interface LoadedBrand { info: BrandInfo; theme: BrandTheme; dir: string;
  icons: { ico: string; png: string; png256: string; svg: string }; logoPath?: string }
export function loadBrand(id = resolveBrandId()): LoadedBrand      // valide, lève BrandError
export class BrandError extends Error {}                            // message : `[brand <id>] <problème>`
```

Validations (chacune lève `BrandError`, critère 9) : dossier absent ; `brand.yaml` illisible ;
`id` absent ou ≠ nom du dossier ou hors `[a-z0-9-]+` ; `productName`/`appId` absents ;
`update.provider` inconnu ou champs manquants ; une des 4 icônes absente ; clé de `theme`
absente de `themeTokens` (`src/renderer/theme.config.ts`) ; valeur de token qui n'est pas un
triplet `"R G B"` (0–255).

**`apps/desktop/scripts/register-brand.ts`** (nouveau) : `globalThis.__POLENTA_BRAND__ = loadBrand().info`.
Importé **en premier** par les points d'entrée exécutés via `tsx` (scripts `check-*.ts`,
`e2e-*.mjs` si concernés, et le nouveau `src/mcp-server/dev-entry.ts`).

**`apps/desktop/src/shared/brand.ts`** (nouveau, importable depuis main, preload, renderer, MCP) :

```ts
declare const __POLENTA_BRAND__: BrandInfo | undefined   // remplacé au build (define)
export const BRAND: BrandInfo = (typeof __POLENTA_BRAND__ !== 'undefined' ? __POLENTA_BRAND__ : undefined)
  ?? (globalThis as { __POLENTA_BRAND__?: BrandInfo }).__POLENTA_BRAND__
  ?? (() => { throw new Error('[brand] marque non injectée : build sans define, ou point d’entrée tsx sans scripts/register-brand.ts') })()
```

`tsconfig.json` : rien à changer (`src/**/*` inclut `src/shared`).

### 2.3 Build & packaging

| Fichier | Modification |
|---------|--------------|
| `electron.vite.config.ts` | `const brand = loadBrand()` ; `define: { __POLENTA_BRAND__: JSON.stringify(brand.info) }` dans `main`, `preload` et `renderer` ; plugin `brandPlugin(brand)` dans `renderer` (§2.4) |
| `electron-builder.yml` → **supprimé**, remplacé par `electron-builder.config.ts` | `export function builderConfig(b: LoadedBrand): Configuration` — reprend **à l'identique** le contenu actuel et ses commentaires (GH26 MAX_PATH, keytar `asarUnpack`, `npmRebuild`, `extraResources`), avec : `appId: b.info.appId`, `productName: b.info.productName`, `extraMetadata.name: b.info.executableName`, icônes `b.icons.*`, `win.artifactName: "<productName sans espaces>-Setup-${version}.${ext}"` (§3 D4), `nsis.shortcutName: productName`, `publish` dérivé de `b.info.update` (github → `{provider, owner, repo, releaseType: 'release'}` ; generic → `{provider: 'generic', url}` ; absent → `publish: null`) |
| `scripts/package.ts` (nouveau) | `loadBrand()` puis `build({ config: builderConfig(brand), publish: 'never' })` (API programmatique `electron-builder`) |
| `scripts/build-mcp-server.ts` (nouveau) | appelle l'API esbuild avec les options actuelles de `build:mcp-server` + `define: { __POLENTA_BRAND__: JSON.stringify(info) }` |
| `package.json` | `build:mcp-server` → `tsx scripts/build-mcp-server.ts` ; `package` → `electron-vite build && pnpm run build:mcp-server && tsx scripts/package.ts` ; `mcp-server` → `tsx src/mcp-server/dev-entry.ts` |
| `dev-app-update.yml` | inchangé (Polenta) ; commentaire : ne vaut que pour la marque polenta |
| `.github/workflows/release.yml` | ajout `workflow_dispatch` avec input `brand` (défaut `polenta`) ; `env: POLENTA_BRAND: ${{ inputs.brand \|\| 'polenta' }}` sur l'étape Package ; la vérification tag/version reste pour le déclenchement par tag ; publication de la release GitHub **seulement** pour `polenta` sur tag — pour une autre marque, `actions/upload-artifact` des fichiers `dist/` (le client héberge lui-même ses releases, §3 D6) |

### 2.4 Plugin Vite `brandPlugin` (`scripts/vite-brand-plugin.ts`, nouveau)

- `transformIndexHtml` : remplace `<title>Polenta</title>` par `productName` et le
  `<link rel="icon" href="/icon.svg">` par l'icône SVG de la marque en `data:` URI
  (`index.html` garde un placeholder `<title>%BRAND_NAME%</title>`).
- Module virtuel `virtual:brand-theme.css` : `:root { --<token>: <light>; … } .dark { --<token>: <dark>; … }`
  pour les seuls tokens surchargés (vide pour Polenta). Importé dans `src/renderer/main.tsx`
  **après** `index.css` → même spécificité, l'ordre fait gagner la marque. Les sorties commitées
  de `theme:generate` (`index.css`, `tailwind.theme.generated.js`) ne changent pas : les noms
  de tokens sont identiques, seules les valeurs CSS sont surchargées.
- Module virtuel `virtual:brand-logo` : `export default '<url du logo>'` (import Vite `?url`
  du `logo.svg` de la marque) ou `export default null`. Déclarations de type dans
  `src/renderer/brand-virtual.d.ts` (nouveau).

### 2.5 Main process

| Fichier | Modification |
|---------|--------------|
| `src/main/index.ts` | `app.setName(BRAND.productName)` ; icône de fenêtre en dev depuis `brands/<id>/icon.{ico,png}` (chemin résolu via `app.getAppPath()` + `BRAND.id`) |
| `src/main/services/auth.service.ts` | `KEYTAR_SERVICE = BRAND.keytarService` ; identité par défaut `{ name: \`${BRAND.productName} User\`, email: \`user@${BRAND.id}.local\` }` |
| `src/main/services/workspace.service.ts` | auteur du commit d'init `{ name: BRAND.productName, email: \`${BRAND.id}@localhost\` }` ; message `Not a ${BRAND.productName} project` |
| `src/main/services/workspace-tree.service.ts` | « … dans Polenta » → `BRAND.productName` |
| `src/main/services/update.service.ts` | `scheduleStartupCheck` : `if (!BRAND.update) return` en premier ; `RELEASES_URL` → `BRAND.releasesUrl` (undefined → pas de `releaseUrl`, le badge gère déjà l'absence) |
| `src/main/services/export-template-library.ts` | `EXAMPLES_FOLDER = \`Exemples ${BRAND.productName}\`` |
| `src/main/services/export/campaign-execution.xlsx.ts` | `workbook.creator = BRAND.productName` |
| `src/main/services/agents-md.template.ts` | `AGENTS_MD_TEMPLATE` devient `buildAgentsMdTemplate(brand: Pick<BrandInfo,'productName'\|'website'>)` ; « Polenta » produit → `productName`, lien `website` ou texte sans lien ; mentions des fichiers de format (`.polenta/`, `polenta-repo.yaml`) inchangées ; `AGENTS_MD_TEMPLATE_VERSION` 3 → 4 ; appelants mis à jour (`workspace.service.ts`, serveur MCP s'il régénère) |
| `src/main/ipc/index.ts` | aucun nouveau canal (le renderer a `BRAND` via define) |

Non modifiés volontairement (identifiants de format, spec §2) : `PolentaRepoService`,
`polenta-repo.yaml`, `window.polenta`, `.mcp.json` (`mcpServers.polenta`), `polenta-mcp-server`,
`rIdPolenta*`, `LOCALE_STORAGE_KEY` (`localStorage` est déjà propre à chaque `userData`).

### 2.6 Serveur MCP

- `src/mcp-server/dev-entry.ts` (nouveau) : `import '../../scripts/register-brand'` puis
  `await import('./index')`.
- `src/main/services/mcp-launch.util.ts` (branche dev) : lance `dev-entry.ts` au lieu de
  `index.ts` et passe `env: { POLENTA_BRAND: BRAND.id }` → le serveur dev utilise la même marque
  que l'app `pnpm dev` qui a écrit `.mcp.json`.
- Bundle packagé : `BRAND` injecté par `build-mcp-server.ts` → même `keytarService` que l'app.

### 2.7 Renderer

| Fichier | Modification |
|---------|--------------|
| `src/renderer/i18n/index.ts` | `interpolation: { escapeValue: false, defaultVariables: { appName: BRAND.productName } }` |
| `locales/fr.json`, `locales/en.json` | chaque « Polenta » désignant le produit → `{{appName}}` (`login.welcome`, `home.demoTitle`, `demoFolderNotEmpty`, `notAWorkspace` ×2, `openExistingHelp`, `notAnExecutionSheet`, titre de mise à jour, `exportTemplatesExamplesHint` → « Exemples {{appName}} ») |
| `src/renderer/hooks/useWorkspaceStructure.ts` | messages en dur → clés i18n avec `{{appName}}` |
| `src/renderer/components/sidebar/ProjectPanel.tsx` | titres `${BRAND.productName} v${version}…` |
| `src/renderer/components/sidebar/AccountPanel.tsx` | bloc « Vérifier les mises à jour » rendu seulement si `BRAND.update` |
| `src/renderer/components/BrandLogo.tsx` (nouveau) | `<img src={logo} alt={BRAND.productName} className="h-12 mx-auto">` ou `null` |
| `src/renderer/routes/login.tsx`, `routes/index.tsx` | `<BrandLogo />` au-dessus du titre / des boutons |
| `src/renderer/main.tsx` | `import 'virtual:brand-theme.css'` après `./index.css` |
| `src/renderer/index.html` | `<title>%BRAND_NAME%</title>`, favicon remplacé par le plugin |

### 2.8 Vérification automatique

`scripts/check-gh49.ts` (nouveau, lancé par `tsx`, même style que `check-gh36.ts`) :
- `loadBrand('polenta')` = valeurs historiques (appId, productName, executableName, keytarService, update) ;
- `loadBrand('demo')` valide ; marques invalides générées dans un dossier temporaire → `BrandError`
  avec le bon message (inconnue, `productName` manquant, icône manquante, token inconnu, triplet invalide) ;
- `builderConfig(polenta)` : mêmes `appId`/`productName`/`extraMetadata.name`/`artifactName`/`shortcutName`/`publish` qu'aujourd'hui ;
- **scan « aucun Polenta visible »** : aucune **valeur** de `fr.json`/`en.json` ne contient
  `Polenta` (insensible à la casse) ; aucune chaîne littérale `'Polenta'`/`"Polenta"`/`` `Polenta `` dans
  `src/main`, `src/renderer` hors liste blanche d'identifiants de format ;
- `buildAgentsMdTemplate({productName: 'Demo Specs'})` ne contient « Polenta » qu'au sein de
  `.polenta/` / `polenta-repo.yaml` / marqueur de version.

Ajouté à la CI ? Pas de job CI de test aujourd'hui pour desktop : lancé à la main, et en
pré-étape de `release.yml` (`pnpm --filter @polenta/desktop exec tsx scripts/check-gh49.ts`).

### 2.9 SPEC à mettre à jour (dernier sprint)

- `SPEC-TECH-stack.md` §9 : marques, `POLENTA_BRAND`, `electron-builder.config.ts` + `scripts/package.ts`, `userData`/keytar par marque, mise à jour par marque.
- `SPEC-TECH-stack.md` §10 : variable `POLENTA_BRAND`.
- `SPEC-I18N.md` : variable globale `{{appName}}`, interdiction de « Polenta » en dur.
- `SPEC-ELECTRON-DESKTOP.md` §2–3 : `src/shared/brand.ts`, plugin Vite de marque ; §19.1 : titre de fenêtre.
- `SPEC-MCP-SERVER.md` §2.4 : `dev-entry.ts`, define de marque dans le bundle.
- `SPEC-INDEX.md` : colonne MAJ + mots-clés (marque, brand, white-label, POLENTA_BRAND).

## 3. Décisions techniques et alternatives rejetées

| # | Décision | Alternatives rejetées |
|---|----------|----------------------|
| D1 | Marque injectée par `define` (constante JSON) | IPC `app:get-brand` : aller-retour asynchrone inutile pour une constante, et indisponible au premier rendu (titre, i18n). Fichier `brand.json` packagé lu au runtime : réintroduit une personnalisation post-install, hors spec |
| D2 | Surcharge de thème par CSS virtuel ajouté après `index.css` | Relancer `theme:generate` par marque : modifie des fichiers commités → working tree sale à chaque build de marque |
| D3 | `electron-builder.config.ts` + API programmatique | Garder le YAML + `--config.xxx=` en ligne de commande : icônes, publish et nsis à surcharger un par un, illisible ; `electron-builder.yml` avec `${env.X}` : pas de logique (publish absent, dérivations) |
| D4 | Nom d'installeur `<productName sans espaces>-Setup-<v>.exe` (« Demo-Specs-Setup-1.0.0.exe ») | Espace dans le nom : GitHub renomme les espaces en points au téléversement, `latest.yml` pointerait vers un fichier inexistant. **Écart avec la spec §3.3** (qui écrivait « Demo Specs-Setup ») — pour Polenta, inchangé |
| D5 | `keytarService = id`, `userData` = `productName` | Garder `polenta` pour tous : comptes partagés entre marques, contraire à la spec §3.5 |
| D6 | Release GitHub publique seulement pour Polenta ; autres marques en artefact CI | Publier les marques client dans `laurentolive/polenta` : exposerait le nom des clients ; leur `update` pointe vers leur propre hébergement |
| D7 | `src/shared/brand.ts` lève une erreur si non injecté | Repli silencieux sur Polenta : un oubli de define livrerait un binaire client affichant « Polenta » (spec §3.2 : jamais de repli) |

## 4. Testabilité locale

- `pnpm dev` → Polenta ; `POLENTA_BRAND=demo pnpm dev` → Demo Specs (titre, logo, couleur, comptes séparés).
- `POLENTA_BRAND=demo pnpm package` → installeur `dist/Demo-Specs-Setup-X.Y.Z.exe`, sans `latest.yml`.
- `pnpm --filter @polenta/desktop exec tsx scripts/check-gh49.ts`.
- Packaging NSIS local : voir `specs/GH28.md` (limite MAX_PATH pnpm) — si bloqué, valider via la CI `workflow_dispatch brand=demo`.

## 5. Découpage — 2 sprints

**Sprint 1 — infrastructure de marque (aucun changement visible pour Polenta)**
§2.1 (marques polenta + demo, déplacement des icônes), §2.2, §2.3, §2.5 lignes `index.ts`,
`auth.service.ts`, `update.service.ts`, §2.6, §2.7 lignes `AccountPanel`/`ProjectPanel`/`index.html`
(titre, favicon via plugin), §2.8 parties chargement/validation/builderConfig.
Fin de sprint : `pnpm dev` et `pnpm package` identiques pour Polenta ; `POLENTA_BRAND=demo`
donne un installeur et une app séparés (nom de fenêtre, icône, données, pas d'update).

**Sprint 2 — textes, thème, logo**
§2.4 thème + logo, §2.5 lignes restantes (textes générés, `AGENTS.md`), §2.7 i18n / messages /
`BrandLogo`, §2.8 scan « aucun Polenta visible », §2.9 mise à jour des SPEC.
