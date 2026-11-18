# GH405 — Scénarios de test

Spec : `specs/GH405.md` — design : `specs/GH405-design.md`.

## Unitaires — `lib/tabCycle.test.ts`

- U1 `tabCycleDirection` : Ctrl+Tab → 1, Ctrl+Shift+Tab → -1, Ctrl+PageDown → 1, Ctrl+PageUp → -1.
- U2 `null` pour : Tab seul, Shift+Tab, Meta+Tab, Ctrl+Alt+Tab, Ctrl+Shift+PageUp/PageDown,
  PageUp seul, Ctrl+T.
- U3 `cycleTabId` : [A B C] depuis A +1 → B ; depuis C +1 → A (bouclage) ; depuis A -1 → C.
- U4 `cycleTabId` : un seul onglet → null ; liste vide → null ; id actif inconnu → null.

## E2E desktop — `e2e-desktop/gh405-tabs.spec.ts` (`-g GH405`)

Projet local ouvert par IPC (modèle gh238), 3 onglets A B C ouverts par Ctrl+T sur des pages
distinctes.

- E1 (crit. 1) Ctrl+Tab ×3 depuis A : B, C, A ; Ctrl+Shift+Tab depuis A : C ; Ctrl+PageDown /
  Ctrl+PageUp idem.
- E2 (crit. 2) ordre visuel après réordonnancement : glisser C avant B (A C B) → Ctrl+Tab depuis A
  active C.
- E3 (crit. 3) un seul onglet : Ctrl+Tab → URL et nombre d'onglets inchangés, pas de dialog.
- E4 (crit. 4) focus dans : champ texte (titre d'exigence enregistré), cellule de la Vue Excel en
  édition, terminal Git Bash (Windows) → l'onglet change ; au retour, valeur du champ inchangée
  (pas de tabulation), terminal sans tabulation reçue.
- E5 (crit. 6) exigence modifiée + Ctrl+Tab → « Quitter cette page ? » ; Rester → même onglet,
  valeur intacte, point « modifié » ; Ctrl+PageDown puis Quitter sans enregistrer → onglet suivant ;
  l'exigence relue par IPC a son titre d'origine.
- E6 (crit. 8) menu ▾ ouvert : Ctrl+Tab ne change pas d'onglet.
- E7 Ctrl+T, Ctrl+W toujours fonctionnels (crit. 10).

## E2E web — `e2e-web/gh405-tab-guard.spec.ts`

- W1 (crit. 6) exigence modifiée, clic sur un autre onglet → popup ; Rester garde la saisie ;
  Quitter → onglet cible, saisie non enregistrée.
- W2 (crit. 6) même chose par le menu ▾ (onglet ouvert).
- W3 (crit. 7) même chose par `+` et par « Récemment fermés ».
- W4 (crit. 5) champ de la vue Édition en saisie, clic sur un autre onglet → pas de popup, valeur
  enregistrée.
- W5 page non modifiée : clic sur un autre onglet → pas de popup.
- W6 (crit. 9) Ctrl+PageDown n'est pas intercepté : aucun changement d'onglet de l'application.
  (Ctrl+Tab ne peut pas être envoyé à la page par Playwright de façon représentative : non testé.)

## Non-régression

- `e2e-web/gh228-navigation.spec.ts` E5 (même popup, désormais `pendingLeave`).
- `pnpm test` complet.

## Manuel (non automatisé)

- Ctrl+Tab maintenu enfoncé (répétition) : défilement onglet par onglet, s'arrête sur une page
  modifiée (popup).
- Barre d'onglets qui déborde : l'onglet atteint par Ctrl+Tab devient visible.
- Focus dans un richtext et dans le diff Raw (CodeMirror) : changement d'onglet sans tabulation.
- macOS : Ctrl+Tab (pas Cmd).
