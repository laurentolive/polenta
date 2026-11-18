# GH405 — Sprint 1 (unique)

Spec : `specs/GH405.md` — design : `specs/GH405-design.md` — tests : `specs/GH405-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `renderer/lib/tabCycle.ts` (+ `.test.ts`) | nouveau : `tabCycleDirection`, `cycleTabId` |
| `renderer/lib/modalOpen.ts` | nouveau (extrait de `useHistoryNavigation`), + `role="menu"`, `data-floating-menu` |
| `renderer/contexts/TabsContext.tsx` | `LeaveAction`, `pendingLeave` / `confirmLeave` / `cancelLeave` (remplacent `pendingHistoryIndex`…), `attemptActivateTab`, `attemptOpenTab`, `attemptReopenClosedTab` |
| `renderer/components/layout/ConfirmLeavePageModal.tsx` | branchée sur `pendingLeave` |
| `renderer/components/layout/TabBar.tsx` | clic et `+` gardés, `data-tab-id` / `data-active`, onglet actif amené dans la partie visible |
| `renderer/components/layout/TabListMenu.tsx` | onglet ouvert et « Récemment fermés » gardés |
| `renderer/hooks/useTabShortcuts.ts` | Ctrl+T gardé ; Ctrl+Tab / Ctrl+PageUp/PageDown en phase de capture (desktop) ; état lu par ref, écouteurs enregistrés une fois |
| `renderer/hooks/useHistoryNavigation.ts` | `modalOpen` partagé |
| `NodeContextMenu`, `ColumnFreezeMenu`, `ParamPicker`, `ElementTree`, `ExcelView`, `WordView`, `TerminalPanel`, `AccountMenu`, `MergeResolvePage` | attribut `data-floating-menu` sur les menus / popovers sans fond |
| `e2e-desktop/gh405-tabs.spec.ts` | nouveau : E1–E7 |
| `e2e-web/gh405-tab-guard.spec.ts` | nouveau : W1–W6 |

## Comportement implémenté

Conforme à la spec : raccourcis desktop, ordre visuel en boucle, actifs partout (capture sur
`window` avant le champ ciblé), ignorés sous une modale ou un menu ; garde « Quitter cette page ? »
sur clic, menu ▾, `+` / Ctrl+T, « Récemment fermés » et raccourcis, desktop et web.

## Divergences par rapport au design

- `modalOpen()` étendu (`role="menu"`, `data-floating-menu`) : design §6.
- Défilement de la barre : calcul sur la barre seule plutôt que `scrollIntoView` (qui fait défiler
  aussi les ancêtres).

## Mises à jour SPEC

- `SPEC-ELECTRON-DESKTOP.md` §19.1 : deux puces « Onglet voisin au clavier (GH405) » et « Garde au
  changement d'onglet (GH405) » ; critère « modale / menu ouvert » de Précédent / Suivant précisé.
- `SPEC-INDEX.md` : ligne §19.1–19.3, description, mots-clés, MAJ → GH405.

## Vérifications

- `pnpm typecheck` : OK. `pnpm lint` : pas de configuration ESLint dans le repo (rien d'exécuté).
- `pnpm test` : 2079 + 124 + 83 tests OK (dont `tabCycle.test.ts`, 4 tests).
- `pnpm test:e2e:desktop -g GH405` : 7/7 (terminal Git Bash compris). Contre-épreuve : sans le
  `stopPropagation`, le test du terminal échoue (bash complète `/tm` en `/tmp/`).
- `e2e-web/gh405-` + `e2e-web/gh228-` : 10/10.
- Revue de code : menus sans fond non détectés (corrigé), écouteurs Ctrl+T/W ré-enregistrés à
  chaque rendu (corrigé), effet de défilement avant la déclaration de sa ref (corrigé), nettoyage
  e2e fragile (corrigé) ; départs non gardés hors spec (merge-resolve, onglet adopté) → #407.
- Suite e2e complète (niveau 3) : non lancée, attend le « Validé ».

## Tester à la main

Desktop (`pnpm dev` depuis le dossier principal), un projet ouvert :

1. Ouvrir 3–4 onglets (Ctrl+T), passer de l'un à l'autre avec Ctrl+Tab, Ctrl+Shift+Tab,
   Ctrl+PageDown, Ctrl+PageUp : ordre de la barre, retour au premier après le dernier.
2. Maintenir Ctrl+Tab : défilement onglet par onglet ; beaucoup d'onglets : l'onglet atteint
   devient visible dans la barre.
3. Focus dans un richtext, une cellule de la Vue Excel en édition, le diff Raw, le terminal :
   Ctrl+Tab change d'onglet, aucune tabulation n'est insérée.
4. Modifier le titre d'une exigence sans enregistrer, puis Ctrl+Tab / clic sur un onglet / `+` :
   « Quitter cette page ? » ; Rester garde la saisie.
5. Clic droit sur un onglet, puis Ctrl+Tab : rien ; Échap, puis Ctrl+Tab : change d'onglet.
6. macOS (si disponible) : Ctrl+Tab, pas Cmd.
7. Client web : clic sur un onglet depuis une exigence modifiée → popup.
