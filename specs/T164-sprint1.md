# T164 — Sprint 1 (unique)

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/renderer/hooks/useScrollToNode.ts` | **nouveau** — hook partagé `useScrollToNode(containerRef, nodeId, seq)` : `querySelector('[data-node-id]')` + `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`, no-op si cible absente. |
| `contexts/SystemViewContext.tsx` | État `gotoTarget: { nodeId, seq }` + `requestGoto` / `clearGoto` ; exposés comme `gotoNodeId` / `gotoSeq` / `requestGoto` / `clearGoto`. Réinitialisé (`{ nodeId: null, seq: 0 }`) dans l'effet `[treeData]` sur changement de nœud/type (`isKeyChange`). Déclaré juste après `useTreeState` (avant l'effet qui le réinitialise). |
| `components/sidebar/SystemPanel.tsx` | `handleGoto(nodeId | null)` : **no-op si `editingNodeId !== null`** (Vue Édition inerte, à la source) ; sinon `requestGoto` / `clearGoto`. Passé à `ElementTree` via `onGoto`. |
| `components/system/ElementTree.tsx` | Prop `onGoto?`. Appels : `handleSelect` (clic **sans** modificateur → `onGoto(nodeId)`, item ou dossier), `handleClickEmpty` (`onGoto(null)`), fin de `handleDrop` (`onGoto(ids[0])`). Navigation clavier : inchangée. |
| `components/system/SystemView.tsx` | Consomme `gotoNodeId` / `gotoSeq` / `clearGoto`. `clearGoto()` ajouté à l'effet d'entrée en Édition. Passe `gotoNodeId` / `gotoSeq` à `ExcelView` et `WordView`. |
| `components/system/ExcelView.tsx` | Props `gotoNodeId` / `gotoSeq` → `useScrollToNode`. `data-node-id={node.id}` + `scroll-mt-8` sur la `<tr>` élément et la `<tr>` de `GroupRow` ; contour `GOTO_OUTLINE_CLASS` (`outline outline-2 -outline-offset-2 outline-status-info-solid`) si `gotoNodeId === node.id` (dossier via prop `isGotoTarget`). |
| `components/system/WordView.tsx` | Props `gotoNodeId` / `gotoSeq` → `useScrollToNode` (nouveau `containerRef` sur le `<div overflow-auto>`). `data-node-id` + contour `GOTO_OUTLINE_CLASS` (`ring-2 ring-inset ring-status-info-solid rounded`) sur `ItemCard` (prop `isGotoTarget`) et sur les en-têtes de dossier `<HeadingTag>`. |
| `specs/SPEC-SYSTEM-VIEW.md` | §Sélection, §Drag & Drop, §Vue document, §Vue Excel, §Vue Word — voir « Mises à jour SPEC ». |
| `specs/SPEC-INDEX.md` | Ligne `SPEC-SYSTEM-VIEW §global` : MAJ `T129 → T164`, description + mots-clés « goto ». |

## Comportement implémenté

Conforme à `specs/T164.md` / `specs/T164-design.md` :

- **Clic simple** (aucun modificateur) sur un item ou un dossier de l'arbre → la vue Word/Excel
  courante défile jusqu'à la ligne / carte / section correspondante (`data-node-id`) et
  l'encadre d'un contour bleu plein persistant. Un seul élément encadré à la fois.
- **Double-clic** : inchangé (Vue Édition).
- **Shift+clic / Ctrl+clic** (multi-sélection) : pas de goto.
- **Clic dans le vide de l'arbre** : désélection + contour effacé.
- **Drag & drop** : au dépôt, goto sur le 1er nœud déplacé.
- **Vue Édition** : `handleGoto` no-op tant que `editingNodeId !== null` — aucune cible ne peut
  être posée pendant l'édition, donc rien de résiduel au retour en Word/Excel.
- **Changement de composant/type** : `gotoTarget` réinitialisé.
- **`gotoSeq`** : re-cliquer / re-droper le même nœud re-déclenche le défilement.

## Divergences par rapport au design

1. **Garde `viewMode === 'edit' ? null : gotoNodeId` abandonnée** : TypeScript la rejette
   (`viewMode` est narrowé à `'excel'` / `'word'` dans ces branches JSX → comparaison jugée
   impossible). Remplacée par la garde **à la source** dans `SystemPanel.handleGoto`
   (`editingNodeId !== null` → return) — approche plus robuste (aucune cible périmée ne peut
   exister), retenue suite à la revue `/code-review`.
2. **Hook partagé `useScrollToNode`** ajouté (le design prévoyait un `useEffect` dupliqué dans
   chaque vue) — suite à la revue.
3. **`scroll-mt-8`** sur les lignes Excel — suite à la revue : `block: 'nearest'` seul plaçait
   la ligne cible sous le `<thead>` sticky (~30 px). Non nécessaire en Word (pas d'en-tête
   figé).

## Limitation connue (hors périmètre, à ticketiser)

**Filtre en mode expression régulière** : `WordView` / `ExcelView` filtrent leur contenu par
sous-chaîne littérale (`.toLowerCase().includes(filter)`), alors que l'arbre honore
`filterOptions` (regex / mot entier / casse). En mode **regex actif**, une ligne visible dans
l'arbre peut ne pas être rendue dans la vue document → le goto est alors un **no-op
silencieux** (comportement déjà prévu par `specs/T164.md` §CU7/E7). Divergence **préexistante**
entre l'arbre et les vues document (les vues n'ont jamais honoré le mode regux du filtre
global) ; la corriger dépasse le périmètre T164 (modifierait la logique de filtrage des deux
vues). Recommandation : ticket dédié « Vue Word/Excel : honorer `filterOptions` du filtre
global ».

## Mises à jour SPEC effectuées

- **`SPEC-SYSTEM-VIEW.md` §Panel Système › Arbre › Sélection** : le tableau des gestes indique
  désormais que le clic simple déclenche un goto ; nouveau paragraphe « Goto (T164) »
  (déclencheurs, cycle de vie du contour, no-op silencieux). La phrase « la sélection dans
  l'arbre n'a aucun impact » est nuancée (aucun impact sur le _contenu_ ; pilote la
  _navigation_).
- **§Arbre › Drag & Drop** : ajout de la puce « Goto au dépôt (T164) ».
- **§Vue document** : phrase d'intro nuancée (contenu vs navigation).
- **§Vue Excel** : puce « Goto depuis l'arbre (T164) » — style du contour (`outline`),
  distinction avec la sélection de ligne, `scroll-margin`.
- **§Vue Word** : puce « Goto depuis l'arbre (T164) » — style du contour (`ring`).
- **`SPEC-INDEX.md`** : ligne `SPEC-SYSTEM-VIEW §global` → colonne MAJ `T164`, description et
  mots-clés enrichis.

## Vérifications

- `pnpm -C apps/desktop typecheck` : **0 erreur**.
- `routeTree.gen.ts` : non modifié.
- `/code-review` (medium) : 2 passes. Pass 1 → 4 findings (E4 edit-mode leak, garde manquante,
  occlusion `<thead>`, duplication) → tous corrigés. Pass 2 → 1 finding (limitation regex
  ci-dessus, préexistante et hors périmètre) → documentée.
- Pas de tests automatiques dans `apps/desktop` (aucun runner).

## Comment tester manuellement

Projet avec beaucoup d'éléments + au moins un dossier non vide (ex. `apps/desktop/PL/Product`).
Vue Système, onglet Exigences ou Tests. Scénarios détaillés dans `specs/T164-tests.md` :

1. **Excel / Word** : scroller en haut, cliquer un élément loin dans l'arbre → la vue défile,
   la ligne/carte est encadrée (contour distinct de la sélection).
2. Cliquer un autre élément → le contour se déplace.
3. Cliquer un **dossier** → goto sur l'en-tête de section / ligne de groupe.
4. **Drag & drop** d'un élément → après le dépôt, la vue est recalée dessus.
5. Double-cliquer → Vue Édition (inchangé). En Édition, cliquer d'autres éléments de l'arbre
   → aucun effet ; revenir → aucun contour/scroll résiduel.
6. **Shift+clic / Ctrl+clic** → aucun scroll, aucun contour.
7. Cliquer dans le vide de l'arbre → contour effacé.
8. Changer d'entrée dans le combobox Composant / Élément → aucun contour résiduel.
9. Onglet Campagnes / panneau Recherche → comportement inchangé (non-régression).
