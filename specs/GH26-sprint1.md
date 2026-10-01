# GH26 — Sprint 1 (unique) : mise à jour automatique de l'application

Spec : `specs/GH26.md` — Design : `specs/GH26-design.md` — Tests : `specs/GH26-tests.md`

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `apps/desktop/electron-builder.yml` | `win.target: nsis`, artefact `Polenta-Setup-${version}.exe`, bloc `nsis` (one-click, `perMachine: false`, raccourcis), bloc `publish: github` (génère `latest.yml`) |
| `apps/desktop/package.json` | `package` → `electron-builder --publish never` |
| `.github/workflows/release.yml` | publie aussi `*.exe.blockmap` et `latest.yml` |
| `apps/desktop/dev-app-update.yml` | *nouveau* — config updater pour `POLENTA_FORCE_DEV_UPDATE=1 pnpm dev` |
| `packages/types/src/app.ts` (+ `index.ts`) | *nouveau* — `AppSettings`, `UpdateStatus`, `UpdateState` |
| `apps/desktop/src/main/services/app-settings.service.ts` | *nouveau* — `userData/app-settings.json`, défauts tolérants |
| `apps/desktop/src/main/services/update.service.ts` | *nouveau* — electron-updater, vérification unique différée de 10 s, push d'état à toutes les fenêtres, `install()` |
| `apps/desktop/src/main/container.ts` | instancie les 2 services ; `createContainer()` retourne `{ update }` |
| `apps/desktop/src/main/index.ts` | `update.scheduleStartupCheck()` après `createAppWindow()` |
| `apps/desktop/src/main/ipc/index.ts` | `app:get-settings`, `app:set-settings`, `app:open-release-page`, `update:get-state`, `update:install` |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `app.getSettings/setSettings/openReleasePage`, namespace `update` |
| `apps/desktop/src/renderer/hooks/useUpdateState.ts` | *nouveau* — query initiale + abonnement `update:state-changed` |
| `apps/desktop/src/renderer/components/layout/UpdateBadge.tsx` | *nouveau* — badge + popover |
| `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` | `<UpdateBadge />` en bas |
| `apps/desktop/src/renderer/components/sidebar/AccountPanel.tsx` | case « Mises à jour auto. » dans Préférences |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | clés `update.*`, `account.panel.autoUpdate(Hint)` |

## Comportement implémenté

Conforme à la spec et au design (y compris la divergence §5 validée : confirmation avant
installation si des onglets de la fenêtre sont dirty — le bouton devient « Installer quand
même » avec un avertissement, pas de modale séparée).

## Divergences par rapport au design

- Lien « Voir les nouveautés » : IPC dédié `app:open-release-page` (restreint aux URL
  `https://github.com/laurentolive/polenta/releases/…`) plutôt qu'un `<a target="_blank">`,
  aucun `setWindowOpenHandler` n'existant (le lien aurait ouvert une fenêtre Electron).
- Popover : bouton « Plus tard » en plus de « Redémarrer pour installer ».
- Découvert en cours de sprint, traité hors ticket (#28) : le packaging NSIS local échouait
  (chemin du store pnpm = 260 caractères > MAX_PATH de makensis) → pnpm 9.15.9 +
  `virtual-store-dir-max-length=60` (commit `[GH28]` séparé).

## Vérifications effectuées

- `pnpm typecheck` (desktop) : 0 erreur.
- `/code-review` : 1 finding — onglets dirty des autres fenêtres non vérifiés, limite acceptée
  (design §5) ; non corrigé.
- `pnpm package` : P1 et P2 OK — `Polenta-Setup-0.0.7.exe`, `.blockmap`, `latest.yml`
  (`path`/`url` = `Polenta-Setup-0.0.7.exe`, `sha512` présent) ; `resources/app-update.yml`
  embarqué (provider github laurentolive/polenta).
- Non vérifié (nécessite une installation et une release N+1) : P3–P6, N1–N7, L1–L15.

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| `SPEC-TECH-stack.md` §9 | Ligne « Application desktop » : installeur NSIS par utilisateur, `--publish never`, artefacts CI ; ligne « Mises à jour » : `UpdateService`, préférence, comportement |
| `SPEC-ELECTRON-DESKTOP.md` §11.2 | Canaux `app:get-version`, `app:get-settings`, `app:set-settings`, `app:open-release-page`, `update:*` |
| `SPEC-ELECTRON-DESKTOP.md` §19.1 | Badge de mise à jour en bas de l'ActivityBar |
| `SPEC-ELECTRON-DESKTOP.md` §19.6 | Section Préférences du panneau Compte, case « Mises à jour auto. » |
| `SPEC-MCP-SERVER.md` §2.4 | Chemins `execPath`/`resourcesPath` stables avec l'installeur |
| `SPEC-INDEX.md` | MAJ → GH26 (TECH §9, MCP §global, DESKTOP §19.1/§19.3), mots-clés ajoutés |

## Tester manuellement

1. `pnpm --filter @polenta/desktop package` → installer `dist/Polenta-Setup-0.0.7.exe` sur un
   compte non admin (P3) ; vérifier comptes et projets récents (P4).
2. Publier une release de test supérieure (ex. tag `v0.0.8` après bump de `package.json`) via
   la CI → relancer l'app installée : badge en < 2 min (N1), popover (N2), lien (N3),
   installation (N4) ou fermeture/relance (N5).
3. Préférence décochée dans Compte › Préférences → relance : aucune ligne `[update]` (L6).
4. Détection seule en dev : `POLENTA_FORCE_DEV_UPDATE=1 pnpm dev` (version locale < dernière
   release publiée contenant `latest.yml`) → badge (L11).

**Attention** : la première release qui contient `latest.yml` sera la 0.0.8 ; une app 0.0.7
installée par cet installeur la détectera. Les utilisateurs de l'exe portable doivent
installer l'installeur une fois à la main (à mentionner dans les notes de release).
