# GH228 — Sprint 1 : navigation Précédent / Suivant

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `renderer/lib/tabHistory.ts` (+ `.test.ts`) | nouveau — pile d'historique, menu, décodage des raccourcis |
| `renderer/contexts/TabsContext.tsx` | `Tab.history`/`historyIndex`, abonnement `router.history` (PUSH = nouvelle entrée), `attemptHistoryNav` + popup, réouverture avec historique, `useSetTabTitle` ré-appliqué, synchronisation en `useLayoutEffect` |
| `renderer/hooks/useHistoryNavigation.ts` | nouveau — clavier, boutons souris, IPC `nav:history`, déduplication |
| `renderer/components/layout/HistoryNavButtons.tsx` | nouveau — `<` `>`, menu d'historique (clic droit / appui long) |
| `renderer/components/layout/ConfirmLeavePageModal.tsx` | nouveau — « Quitter cette page ? » |
| `renderer/components/layout/TabBar.tsx` | intégration |
| `renderer/contexts/SystemViewContext.tsx` | `view` / `item` dans l'URL, `viewMode`, `storedViewMode`, `showView`, `showObject`, `editingNodeId` dérivé, goto → `item` |
| `renderer/components/system/SystemView.tsx` | état de vue local, `backHistory`, « ← Retour » et « Retour » d'Édition retirés ; `Échap` = page précédente ; titre d'onglet |
| `renderer/routes/req.$reqId.tsx`, `test.$testId.tsx`, `campaign.$campaignId.tsx`, `diff.tsx` | « Retour » doublon de Précédent retiré (diff d'un commit : retour au graphe conservé) |
| `renderer/components/sidebar/SystemPanel.tsx` | clic dans le vide de l'arbre retire `item` |
| `renderer/routes/product.tsx`, `components.tsx` | `validateSearch` : `view`, `item` optionnels |
| `main/index.ts` | `app-command` / `swipe` → `nav:history` |
| `renderer/i18n/locales/{fr,en}.json` | libellés |
| `e2e-web/gh228-navigation.spec.ts` | nouveau (E1–E7) ; `gh105-cross-repo-links.spec.ts` : Précédent remplace « ← Retour » |

## Comportement implémenté

Conforme à `specs/GH228.md`, avec les ajustements ci-dessous.

## Divergences par rapport au design / à la spec

- **Goto = remplacement, pas nouvelle page** (revue de code) : un clic simple dans l'arbre met
  `item` à jour dans l'URL de la page courante. Une nouvelle entrée par clic remplissait la pile
  (50 entrées) et faisait atterrir Précédent, depuis l'Édition, sur le clic qui précède le
  double-clic. Spec §3 mise à jour.
- **Boutons « Retour » doublons de Précédent supprimés** (demande après validation, spec §2.2
  bis) : vue système en Édition, fiche campagne, diff du répertoire de travail, fiches `/req/…` et
  `/test/…`. `Échap` en Édition revient à la page précédente de l'onglet quand c'est encore la vue
  système (rétablit le retour vers l'objet d'origine après un lien, que l'ancien `backHistory`
  assurait), sinon au dernier mode Tableau / Document positionné sur l'élément. Les liens vers
  une page parente (campagne, graphe, Structure) sont conservés.
- **Titres** : la vue système pose son titre d'onglet (« ID — titre » en Édition, sinon
  « composant / type ») pour que le menu d'historique distingue les pages ; `useSetTabTitle` se
  ré-applique quand une navigation remet le titre par défaut ; synchronisation `TabsProvider` en
  `useLayoutEffect` pour que le titre affiné d'une page ne soit jamais écrit sur la précédente.
- **CA2** : un rechargement de la fenêtre repart de l'accueil du projet (démarrage de l'appli,
  `main.tsx`, inchangé) ; le CA vérifie la navigation vers l'URL depuis une autre page.
- **Vue Recherche** : goto non historisé (design §6).
- **Lien vers un objet d'une autre catégorie** (ex. test lié, cliqué depuis Exigences) : l'URL
  bascule aussi `category` (`showObject(..., category)`), sinon le type cible n'était pas
  affichable. Corrige au passage `gh169-excel-link-navigate` GH169-1, qui échouait déjà sur `main`.
- **Accepté** : une entrée « Édition sans `item` » (nœud dont la création d'objet a échoué) se
  réaffiche avec le dernier nœud sans objet ouvert ; cas limite, l'URL est complétée dès que
  l'objet existe.

## Mises à jour SPEC

- `SPEC-ELECTRON-DESKTOP.md` §19.1 : Précédent / Suivant par onglet (historique, déclencheurs,
  popup, client web) ; `useSetTabTitle` ré-appliqué. §19.3 : `/product`, `/components` →
  `view`, `item`.
- `SPEC-SYSTEM-VIEW.md` : « ← Retour » remplacé (navigation par lien) ; §Persistance : `view`,
  `item` dans l'URL, règles PUSH / REPLACE, résolution de l'élément.
- `SPEC-INDEX.md` : lignes correspondantes, MAJ → GH228.

## Tests

- Unitaires : `lib/tabHistory.test.ts` (U1–U7) ; suite complète verte.
- E2E web : `gh228-navigation.spec.ts` (E1–E7), `gh105-cross-repo-links.spec.ts` (E8).
- `gh222-diff-edit` « 15/16 — Rendu » échoue aussi sur `main` sans GH228 (hors ticket).

## Comment tester manuellement (desktop)

`pnpm --filter @polenta/desktop dev` depuis le dossier principal, puis :
- M1 Windows : boutons latéraux de la souris → un seul pas par clic.
- M2 macOS : `Cmd+[` / `Cmd+]` ; `Cmd+←` dans un champ texte déplace le curseur ; balayage trackpad.
- M3 : fermer un onglet ayant un historique, le rouvrir par ▾ → « Récemment fermés », `<` fonctionne.
- Parcours : Exigences → Tableau → Document → Éditer un élément → suivre un lien vers un autre
  repo → `Alt+←` ×N ; clic droit sur `<` pour le menu ; modifier le titre d'une fiche `/req/…`
  puis `Alt+←` → popup.
