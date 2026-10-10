# GH49 — Sprint 1 : infrastructure de marque

Spec : [GH49.md](GH49.md) — Design : [GH49-design.md](GH49-design.md) — Tests : [GH49-tests.md](GH49-tests.md)

## Comportement implémenté

- Une marque = `apps/desktop/brands/<id>/` (`brand.yaml`, `icon.ico/png/svg`, `icon-256.png`,
  `favicon.svg` et `logo.svg` optionnels). Choisie au build par `POLENTA_BRAND` (défaut `polenta`).
- `scripts/brand.ts` lit et valide la marque ; toute anomalie (marque inconnue, clé obligatoire
  absente, `id` ≠ dossier, icône manquante, token de thème inconnu, triplet RGB invalide,
  provider inconnu, `productName` inutilisable comme nom de fichier) fait échouer le build.
- La marque est figée dans les bundles main, preload, renderer (`define` electron-vite) et dans
  le bundle du serveur MCP (`scripts/build-mcp-server.ts`) ; le code applicatif la lit via
  `src/shared/brand.ts` (`BRAND`), qui lève une erreur explicite si elle n'est pas injectée.
- Packaging : `electron-builder.yml` remplacé par `electron-builder.config.ts` (fonction de la
  marque) + `scripts/package.ts` (API programmatique). `package.ts` refuse de packager si
  `out/main` et `out/mcp-server` ont été construits pour des marques différentes.
- Par marque : nom de l'app (`app.setName` → dossier userData), service keytar (`BRAND.id`),
  `appId`, nom d'installeur, raccourci, icônes, source de mise à jour. Marque sans `update` :
  ni `latest.yml`, ni `app-update.yml`, aucune vérification, préférence masquée (panneau Compte).
- Titre de fenêtre (`ProjectPanel`) et `<title>` / icône d'onglet (`index.html`, plugin Vite) au
  nom et à l'icône de la marque.
- Serveur MCP en dev : `src/mcp-server/dev-entry.ts` (marque via `--brand <id>`, écrit dans
  `.mcp.json` par l'app `pnpm dev`).
- CI : `release.yml` accepte un déclenchement manuel `brand` → installeur en artefact du run,
  jamais publié en release ; le déclenchement par tag reste Polenta, inchangé.
- Marque de test `brands/demo` (« Demo Specs », orange, logo, sans mise à jour).

**Polenta inchangé** (vérifié par packaging local) : `Polenta-Setup-0.0.8.exe`, `Polenta.exe`,
`latest.yml` + `app-update.yml` (github laurentolive/polenta, `updaterCacheDirName: polenta-updater`),
dossier userData « Polenta », service keytar `polenta`.

## Fichiers

| Fichier | Nature |
|---------|--------|
| `apps/desktop/brands/polenta/*` | nouveau `brand.yaml` ; icônes déplacées de `build/`, favicon de `src/renderer/public/icon.svg` |
| `apps/desktop/brands/demo/*` | nouveau (marque de test) |
| `apps/desktop/src/shared/brand-types.ts`, `src/shared/brand.ts` | nouveaux |
| `apps/desktop/scripts/brand.ts`, `register-brand.ts`, `vite-brand-plugin.ts`, `package.ts`, `build-mcp-server.ts`, `check-gh49.ts` | nouveaux |
| `apps/desktop/electron-builder.config.ts` | nouveau (remplace `electron-builder.yml`, supprimé) |
| `apps/desktop/electron.vite.config.ts` | `define` + plugin de marque |
| `apps/desktop/package.json` | scripts `package`, `build:mcp-server`, `mcp-server` |
| `apps/desktop/dev-app-update.yml` | commentaire (Polenta seulement) |
| `apps/desktop/src/main/index.ts` | `app.setName(BRAND.productName)`, icône de fenêtre de la marque |
| `apps/desktop/src/main/services/auth.service.ts` | `KEYTAR_SERVICE = BRAND.id` |
| `apps/desktop/src/main/services/update.service.ts` | pas de vérification sans `update` ; URL de notes de version de la marque ; `POLENTA_FORCE_DEV_UPDATE` réservé à Polenta |
| `apps/desktop/src/main/services/mcp-launch.util.ts` | dev : `dev-entry.ts --brand <id>` |
| `apps/desktop/src/mcp-server/dev-entry.ts` | nouveau |
| `apps/desktop/src/renderer/index.html` | placeholders `%BRAND_NAME%` / `%BRAND_FAVICON%` |
| `apps/desktop/src/renderer/components/sidebar/ProjectPanel.tsx`, `AccountPanel.tsx` | titre de fenêtre ; préférence de mise à jour masquée sans `update` |
| `.github/workflows/release.yml` | `workflow_dispatch` avec `brand` |

## Divergences par rapport au design

- **`BrandInfo.keytarService` supprimé** (revue de code) : c'était toujours `id`, deux champs à
  garder synchrones ; `auth.service.ts` utilise `BRAND.id` directement.
- **Nom d'installeur** : `artifactBaseName` réduit le nom à `[A-Za-z0-9._-]` (accents retirés,
  le reste → tiret), pas seulement les espaces : GitHub renomme aussi les autres caractères
  spéciaux. « L'Outil Été » → `L-Outil-Ete-Setup-X.Y.Z.exe`.
- **`productName` validé comme nom de fichier** (`< > : " / \ | ? *`, point/espace final interdits)
  — il nomme le dossier userData et le raccourci.
- **Serveur MCP en dev** : marque passée par l'argument `--brand` au lieu d'un bloc `env` dans
  `.mcp.json` (certains clients MCP remplacent tout l'environnement par ce bloc).
- **Notes de version** : suffixe `/tag/v<version>` seulement pour une source GitHub ; une source
  `generic` pointe vers `releasesUrl` telle quelle.
- **`POLENTA_FORCE_DEV_UPDATE`** ignoré hors marque `polenta` (`dev-app-update.yml` décrit la
  source de Polenta).
- **`package.ts`** vérifie que `out/main` et `out/mcp-server` portent le même `appId` que la
  marque à packager.

## Revue de code — points écartés

- Doublon `escapeHtml` (plugin Vite vs `src/renderer/lib/markdownParamRefs.ts`) : le script de
  build n'importe pas de code du renderer ; fonction de 1 ligne.
- `permissions: contents: write` hérité par le déclenchement manuel de `release.yml` : un seul
  job ; le déclenchement manuel est réservé aux personnes ayant les droits d'écriture sur le repo.
- IPC `update:*` toujours enregistrés sans `update` : sans effet (`install()` n'agit qu'en état `ready`).

## Point ouvert — à arbitrer avant le sprint 2

Le repo `laurentolive/polenta` est **public** (spec GH26) : un dossier `brands/<client>/` commité
y rendrait visibles le nom, le logo et l'URL de mise à jour du client. La décision D6 (pas de
release publique pour les marques client) ne suffit donc pas à garder la marque confidentielle.
Pistes : dossier de marques hors repo (`POLENTA_BRANDS_DIR`), repo privé de marques monté en CI,
ou accord explicite du client. `brands/demo` (fictive) n'est pas concernée.

## Tests

- `pnpm --filter @polenta/desktop exec tsx scripts/check-gh49.ts` : **41 ok, 0 échec** (Polenta et
  `POLENTA_BRAND=demo`) — B1–B10, P1, P2, P5, L4, L6, L7.
- Non-régression : `check-gh34.ts` 118 PASS, `check-gh36.ts` 67 PASS ; `tsc --noEmit` sans erreur.
- Packaging local : P3 (Polenta) et P4 (demo : `Demo-Specs-Setup-0.0.8.exe`, `Demo Specs.exe`,
  pas de `latest.yml`/`app-update.yml`, bundle MCP sur keytar `demo`) conformes ; mélange de
  marques refusé par `package.ts`.
- Serveur MCP dev : `dev-entry.ts --brand demo` répond à `initialize` ; `--brand nope` → `BrandError`.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev` → app Polenta identique (titre, icône d'onglet, projets
   récents et comptes retrouvés).
2. `POLENTA_BRAND=demo pnpm --filter @polenta/desktop dev` → titre « Demo Specs vX — … », icône
   orange, aucun projet récent ni compte de Polenta, pas de case « Vérifier les mises à jour ».
3. `POLENTA_BRAND=demo pnpm --filter @polenta/desktop package` → installer
   `dist/Demo-Specs-Setup-X.Y.Z.exe` ; raccourci « Demo Specs » ; lancer Polenta et Demo Specs
   en même temps (L1).
4. Projet de dev existant : son `.mcp.json` lance encore `src/mcp-server/index.ts` (avant GH49),
   qui échoue désormais (« marque non injectée ») — supprimer `.mcp.json` pour qu'il soit
   régénéré à l'ouverture. Ne concerne que les projets créés depuis `pnpm dev`, pas les
   installations packagées.

Hors périmètre sprint 1 (sprint 2) : textes i18n `{{appName}}`, messages main, AGENTS.md,
dossier d'exemples, auteur Excel, thème, logo, scan « aucun Polenta visible ».
