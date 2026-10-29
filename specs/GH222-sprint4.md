# GH222 — Sprint 4 : vue générique en merge (dernier sprint)

Spec : `specs/GH222.md` §4, §6 · Design : `specs/GH222-design.md` §5.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `components/treediff/mergeModel.ts` | **nouveau** — modèle de la vue de merge : rangées = union alignée des deux côtés, ce que chaque côté a changé depuis l'ancêtre, valeur de l'ancêtre, blocs de conflit et blocs résolus rattachés aux rangées (plusieurs par rangée ; blocs sans rangée listés à part), lecture de la sortie au chemin d'une rangée (`outputAt`) ; rien n'est calculé hors Rendu |
| `components/treediff/TreeMerge.tsx` | **nouveau** — `MergeTreeTop` (Structure \| mes modifications \| [ancêtre] \| destination, « Prendre gauche / droite » sur la rangée du bloc) et `MergeTreeOutput` (Structure \| sortie : une carte par conflit — gauche · droite · les deux —, blocs résolus avec « Réinitialiser », valeurs éditables en place : scalaires, statut, widgets du schéma) |
| `components/merge/DrawioMergeOutput.tsx` | **nouveau** — `.drawio` en Rendu : une carte par page en conflit, les deux pages rendues à leur commit, choix gauche / droite |
| `components/merge/FileResolver.tsx` | Rendu pour tout fichier YAML et les `.drawio` (y compris un fichier à choix de côté, en lecture) ; édition en place par `updateOutputAt` dans le style YAML du fichier ; navigation des conflits sur les cartes |
| `components/merge/scrollSync.ts` | défilement synchronisé sur un attribut au choix (`data-row-key`) |
| `components/merge/RenderedObjectPane.tsx` | **retiré** (Rendu des seules exigences / tests de GH37) |
| `components/diff/DrawioFileDiffView.tsx` | `DrawioPageView` exporté |
| `i18n/locales/{fr,en}.json` | libellés |
| `TreeMerge.test.ts`, `e2e-web/gh222-tree-merge.spec.ts` | **nouveaux** |

## Comportement implémenté

- Résolution en Rendu pour **tout fichier YAML** : la rangée du haut et la sortie ont chacune leur
  colonne Structure, montrent les mêmes nœuds, se replient ensemble et défilent ensemble.
- Chaque panneau du haut marque ce que son côté a changé depuis l'ancêtre ; « Prendre gauche /
  droite » est posé sur la rangée du bloc dans son panneau ; la sortie montre une carte par conflit.
- Édition en place : texte, nombre (converti quand la saisie est un nombre complet), booléen,
  statut (liste), champs du schéma (widgets de l'éditeur, `multi_enum` gardé en liste s'il l'était,
  dates au format de la saisie).
- `.drawio` : pages des deux côtés en haut (vue de diff GH178), choix par page dans la sortie.

## Divergences par rapport au design

- Le bloc d'une plage d'éléments d'une liste alignée (étapes d'un test) est rattaché à la rangée de
  la **liste** : la position d'un élément dans la sortie du merge et dans l'alignement des deux
  côtés peuvent différer.
- Pas de bascule « forcer un bloc repris vers l'autre côté » en Rendu (spec §6) : un bloc repris
  automatiquement se change par l'édition en place ou en Raw.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TECH-stack.md` §2 | `@polenta/merge-core` : moteur générique ; nouvelle ligne `@codemirror/merge` 6.12.2 (`DIFF_CONFIG`) ; CodeMirror : décorations caractère, actions dans chaque panneau |
| `SPEC-TECH-stack.md` §6.1, §6.5 | règles de fusion comme descriptions du moteur (étapes, runs, YAML générique, arbres, `.drawio`, repli texte du YAML non canonique) ; vues de diff sur `RawDiffView` / `TreeDiffView` ; « non implémenté » mis à jour |
| `SPEC-TECH-stack.md` §6.6 | **nouvelle** — moteur, session, mise en évidence, Raw, vue générique, règle du thème |
| `SPEC-ELECTRON-DESKTOP.md` §19.3, §19.8b | route `/diff` ; vues de diff (Raw côte à côte / en ligne, navigation, Rendu générique, préférences) |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2.4, §5.6 | résolution : Rendu de tout YAML et des `.drawio`, mise en évidence, blocs (étape, run, nœud, position, page), actions ; comparaison entre baselines |
| `SPEC-THEMING.md` §3.1b, §3.2 | **nouvelle** famille `diff-*` ; les indicateurs de diff ne passent plus par `status-*` |
| `SPEC-INDEX.md` | colonne `MAJ` → GH222 pour les 7 lignes concernées |

## Revue de code

`/code-review` (medium) : 10 constats, corrigés — champs d'une étape introuvables dans la sortie,
étape cherchée dans la seule version de droite, plusieurs blocs sur une même rangée (une seule
carte), bloc rattaché à une rangée inexistante (désormais listé « Hors structure »), `.drawio`
fusionné en texte sans carte, saisie d'un nombre décimal impossible, `multi_enum` réécrit en
chaîne, date vide dans le sélecteur, modèle calculé en Raw, Rendu refusé pour un fichier à choix
de côté.

## Tests

- Unitaires : renderer 203 (dont `TreeMerge.test.ts`), merge-core 74.
- e2e : `gh222-tree-merge` (R1–R4, R6, R8), `gh222-tree-diff`, `gh222-raw`, `gh178-*`, `gh145`.

## Comment tester manuellement

1. Deux branches modifiant la même valeur d'un YAML (`config/*.yaml`, `links/links.yaml`, une
   exigence), merger depuis la vue graphe → « Résoudre les conflits » → **Rendu** : colonne
   Structure en haut et dans la sortie, cartes de conflit, « Prendre droite » dans le panneau de
   droite, édition d'une valeur dans la sortie, `F7`.
2. Un `.drawio` modifié sur la même page des deux côtés : Rendu → pages des deux côtés, choix par
   page.
3. Finaliser : le fichier fusionné contient les choix faits en Rendu.
