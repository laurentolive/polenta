# GH342 — Sprint 2 : événements par fenêtre, garde de fermeture, pull automatique

## Fichiers

| Fichier | Changement |
|---|---|
| `main/services/terminal.service.ts`, `main/index.ts` | sortie du terminal envoyée au seul webContents propriétaire |
| `main/ipc/desktop-only.handlers.ts` | dialogues natifs (`showOpen` / `showSave` / `showError`) rattachés à la fenêtre appelante ; `app:close-window`, `app:auto-pull-owner` ; invitation au lancement réservée à une fenêtre fixée (`pendingInviteWindow`) |
| `main/host/app-windows.ts` | garde `close` (demande au renderer, accusé de réception 3 s, fermeture forcée si renderer planté / bloqué, réarmée au rechargement) ; `before-quit` : sortie retardée une fois, saisies de toutes les fenêtres enregistrées (≤ 2,5 s) ; `isAutoPullOwner` |
| `main/ipc/channels.ts`, `packages/api-client` | `app:close-window`, `app:auto-pull-owner` |
| `renderer/lib/pendingEdits.ts` (+ test) | registre des enregistrements temporisés et des appels en cours ; `flushPendingEdits` |
| `renderer/api.ts` | appels au main suivis (hors `app:*`) |
| `renderer/components/system/{EditView,SystemView}.tsx` | enregistrements temporisés lancés à la demande |
| `renderer/components/layout/WindowCloseGuard.tsx`, `routes/__root.tsx`, i18n | confirmation de fermeture (liste des onglets non sauvegardés), aussi montée sur `/login` |
| `renderer/hooks/useAutoPull.ts`, `renderer/web/bridge.ts` | tick ignoré si la fenêtre n'est pas responsable du projet (web : toujours responsable) |

## Divergences par rapport au design

- **Pull automatique** : fenêtre responsable par projet au lieu de partager / réutiliser le résultat
  de `sync:auto-sync` pendant 30 s (implémenté puis retiré après revue : résultat périmé, effets du
  pull sautés). Design §2.5 mis à jour.
- **Sortie de l'application** (Cmd+Q, installation d'une mise à jour, `app.quit()`) : pas de garde
  ni de confirmation, mais les saisies en attente sont enregistrées (`app:flush-requested`) — non
  prévu au design, relevé par la revue.
- **Attente des enregistrements** : une tâche complète avant de relever les appels en cours —
  `mutate()` de TanStack Query n'appelle le main qu'après plusieurs micro-tâches.
- Invitation et relance de l'exécutable : faites au sprint 1.

## Vérifications

- `pnpm typecheck` OK ; unitaires desktop 1743/1743 (+ merge-core, admin-service).
- e2e desktop `gh342-windows` : 12/12, trois exécutions consécutives (P1 terminal, P2 dialogue,
  P4 confirmation, P5 fermeture en cours de saisie, P7 fermeture du projet, P8 sortie en cours de
  saisie, CA9 fenêtre responsable).
- e2e web `gh342-windows` (W1–W4) + voisines (gh74-editing, gh229, gh228, gh65-navigation) : 29/29 ;
  gh152, gh246, gh230, gh250, gh169 : OK avant les corrections de revue (non relancées après — le
  changement de revue ne touche pas ces vues).
- Revue de code (PR #344) : 8 constats ; 6 corrigés, 2 acceptés :
  - fenêtre rouverte sur un projet après une déconnexion dans une autre fenêtre (desktop, cas
    limite ; le web contrôle la session côté serveur) ;
  - double analyse de `pathname?search` (`splitAppRoute` / `parseSearch` : même `URLSearchParams`
    d'une ligne).

## Tester à la main

1. Deux fenêtres sur le même projet, une exigence modifiée sans l'enregistrer dans la fenêtre 2 :
   fermer la fenêtre 2 → confirmation avec le nom de l'onglet ; « Annuler » la garde.
2. Vue Édition, taper dans un champ riche puis fermer la fenêtre aussitôt → la saisie est dans le
   fichier (git diff).
3. Terminal (Ctrl+ù) dans la fenêtre 1 : rien n'apparaît dans un terminal de la fenêtre 2.
4. Exporter depuis la fenêtre placée sur le second écran : la boîte « Enregistrer sous » s'y ouvre.
