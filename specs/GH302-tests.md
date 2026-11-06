# GH302 — Scénarios de test

## Unitaires — `UpdateService` (electron-updater simulé)

| # | Scénario | Attendu |
|---|----------|---------|
| U1 | `update-available`, préférence active | état `available` diffusé, puis `downloadUpdate()` appelé |
| U2 | `download-progress` 12.4 puis 12.9 puis 13.1 | `downloading` progress 12, puis 13 ; une seule diffusion pour 12 |
| U3 | `update-downloaded` | `ready` |
| U4 | préférence décochée | vérification faite ; `available`, pas de `downloadUpdate()` ; `download()` → téléchargement |
| U5 | verrou (`autoCheckUpdatesLocked`) | vérification faite ; `available` + `managed` ; `download()` refusé |
| U6 | `error` sans version connue | `idle` (silencieux) |
| U7 | `error` avec version connue | `error` ; `download()` relance check + download |
| U8 | minuterie 4 h | nouvelle vérification ; sautée en `ready` |
| U9 | préférence cochée pendant `available` (`onSettingsChanged`) | téléchargement lancé |
| U10 | `install()` | `installing` diffusé, serveurs MCP arrêtés, `quitAndInstall(false, true)` |
| U11 | `prepareInstall()` | nombre de serveurs MCP et d'autres fenêtres |
| U12 | marque sans `update` / non packagé | aucune vérification (inchangé) |

Tests GH293 existants adaptés (plus de boîte native dans `install()`).

## Unitaires — renderer

| # | Scénario | Attendu |
|---|----------|---------|
| R1 | état absent / idle | pas de bouton |
| R2 | `available` (auto) | bouton, popover « vX disponible » |
| R3 | `available` + préférence décochée | bouton « Télécharger » → `api.update.download` |
| R4 | `available` + `managed` | message « gérées par votre service informatique », aucune action |
| R5 | `downloading` 42 | « 42 % », barre |
| R6 | `ready` | « Redémarrer pour installer » → confirmation |
| R7 | confirmation | liste onglets non enregistrés, fenêtres, serveurs MCP ; Annuler ne lance rien |
| R8 | `error` | « Réessayer » → `api.update.download` |
| R9 | `installing` | écran d'installation |
| R10 | web : `servedVersion` | « Recharger la page » pour tout utilisateur |
| R11 | web : `available` admin / non-admin | visible / absent |

## Unitaires — serveur web

| # | Scénario | Attendu |
|---|----------|---------|
| W1 | `isNewer` | 1.2.0 > 1.1.9 ; 1.2.0 > 1.2.0-alpha.3 ; égalité → false ; `v` toléré |
| W2 | release GitHub plus récente | `web:update-state` → `available` + version + releaseUrl |
| W3 | release identique ou plus ancienne / échec réseau | `idle` |
| W4 | marque sans `update` | aucune requête |
| W5 | channel policy | `web:update-state` exposé ; `update:download`, `update:prepare-install` non exposés |

## e2e web (`e2e-web/gh302-*.spec.ts`)

| # | Scénario |
|---|----------|
| E1 | Page chargée, puis la version servie change (réponse `web:update-state` interceptée) → bouton « Recharger la page » |
| E2 | Release disponible (réponse interceptée) : visible pour l'administrateur si l'environnement e2e en fournit un ; sinon absent pour un utilisateur ordinaire |

## Manuel (non automatisable)

- M1 — CA9 de bout en bout : installer la version N, publier N+1, vérifier bouton « disponible » →
  progression → « prête » → confirmation → écran d'installation → fenêtre de l'installeur → relance
  sur N+1, serveurs MCP arrêtés.
- M2 — CA2 : app ouverte plus de 4 h (ou minuterie raccourcie en dev) détecte une release.
- M3 — `POLENTA_FORCE_DEV_UPDATE=1` en `pnpm dev` : états disponible / téléchargement / prête.
