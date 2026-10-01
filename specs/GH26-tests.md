# GH26 — Scénarios de test : mise à jour automatique

Spec : `specs/GH26.md` — Design : `specs/GH26-design.md`

Pas de framework de test automatisé côté `apps/desktop` pour le main process Electron :
vérifications par `typecheck`, build packagé et tests manuels ci-dessous.
Notation : N = version installée, N+1 = version publiée plus récente.

## 1. Packaging & CI

| # | Scénario | Attendu |
|---|----------|---------|
| P1 | `pnpm --filter @polenta/desktop package` | `dist/` contient `Polenta-Setup-X.Y.Z.exe`, `Polenta-Setup-X.Y.Z.exe.blockmap`, `latest.yml` ; aucune tentative de publication dans la sortie. |
| P2 | Ouvrir `latest.yml` | `version: X.Y.Z`, `path`/`files[0].url` = `Polenta-Setup-X.Y.Z.exe`, `sha512` présent. |
| P3 | Lancer l'installeur sur un compte non admin | Pas d'invite UAC ; app installée dans `%LOCALAPPDATA%\Programs\Polenta` ; raccourcis bureau + menu Démarrer ; l'app démarre. |
| P4 | Premier lancement après l'ancien portable | Comptes (auth.json/keytar) et projets récents retrouvés. |
| P5 | Push d'un tag `vX.Y.Z` (CI) | La release GitHub contient les 3 fichiers de P1. |
| P6 | Serveur MCP en build installé | `.mcp.json` régénéré pointe vers `…\Programs\Polenta\resources\mcp-server\index.cjs` ; un client MCP s'y connecte. |

## 2. Nominal (golden path)

| # | Scénario | Attendu |
|---|----------|---------|
| N1 | N installé, N+1 publié, préférence active, réseau OK, lancement | Aucune popup ; en < 2 min, badge en bas de l'ActivityBar ; info-bulle « Polenta vN+1 est disponible ». Logs main : `[update] checking`, `update-available`, `update-downloaded`. |
| N2 | Clic sur le badge | Popover : version actuelle N → N+1, lien « Voir les nouveautés », bouton « Redémarrer pour installer ». Escape / clic extérieur le ferment, le badge reste. |
| N3 | Clic « Voir les nouveautés » | Page `…/releases/tag/vN+1` ouverte dans le navigateur système, pas dans Electron. |
| N4 | Clic « Redémarrer pour installer » (aucun onglet dirty) | L'app se ferme, s'installe sans assistant, se relance ; titre `Polenta vN+1`. |
| N5 | Après N1, ne pas cliquer ; fermer l'app ; relancer | L'app démarre en N+1. |
| N6 | Deux fenêtres ouvertes au moment du téléchargement | Le badge apparaît dans les deux. |
| N7 | Fenêtre ouverte (menu) **après** `update-downloaded` | Le badge est présent immédiatement (via `update:get-state`). |

## 3. Cas limites

| # | Scénario | Attendu |
|---|----------|---------|
| L1 | Installée = dernière release | Aucun badge, aucun message. |
| L2 | Réseau coupé au lancement | Aucun badge, aucun message, aucune erreur visible ; erreur journalisée seulement. |
| L3 | Release N+1 sans `latest.yml` (ancienne release / upload raté) | Idem L2. |
| L4 | Seule release plus récente marquée pré-release | Non proposée (aucun badge). |
| L5 | Release draft N+1 | Non proposée. |
| L6 | Préférence décochée, relance | Aucune ligne `[update]` dans les logs ; aucun badge. |
| L7 | Préférence décochée puis recochée, relance | Comportement N1 rétabli. |
| L8 | `app-settings.json` absent | Préférence affichée cochée (défaut), vérification active. |
| L9 | `app-settings.json` corrompu (JSON invalide) | Pas de crash ; défauts appliqués ; l'enregistrement suivant réécrit un fichier valide. |
| L10 | `pnpm dev` sans `POLENTA_FORCE_DEV_UPDATE` | Aucune vérification. |
| L11 | `POLENTA_FORCE_DEV_UPDATE=1 pnpm dev` avec N+1 publié | Détection et badge fonctionnels (installation non testée en dev). |
| L12 | Onglet d'édition avec modifications non enregistrées + clic « Redémarrer pour installer » | Confirmation affichée ; Annuler → rien ne se passe, saisie intacte ; Confirmer → installation (N4). |
| L13 | Coupure réseau pendant le téléchargement | Pas de badge ; pas de message ; nouvelle tentative au prochain lancement. |
| L14 | Lancement sans projet ouvert (page d'accueil) | Badge visible quand prêt (ActivityBar présente sans projet). |
| L15 | Langue EN | Libellés du badge, du popover et de la préférence en anglais. |

## 4. Critères d'acceptation vérifiables

- Spec §3 critères 1–12 couverts par : 1→P1, 2→P3, 3→P5, 4→N1, 5→N4+P4, 6→N5, 7→L1, 8→L2,
  9→L6, 10→L4, 11→L10, 12→L15.
- `pnpm --filter @polenta/desktop typecheck` : zéro erreur nouvelle.
- `/code-review` sur le diff sans finding bloquant.
