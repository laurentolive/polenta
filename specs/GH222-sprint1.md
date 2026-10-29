# GH222 — Sprint 1 : moteur YAML générique

Spec : `specs/GH222.md` · Design : `specs/GH222-design.md` §2, §3.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/merge-core/src/path.ts` | **nouveau** — chemins de nœuds, pointeur échappé (`/a~1b/@id/#2`), motifs |
| `packages/merge-core/src/structure.ts` | **nouveau** — descriptions (`OBJECT_DESC`, `LINKS_DESC`, `PARAMETERS_DESC`, `genericDesc`), heuristiques d'identité (`listRuleOf`), style YAML de l'app (`yamlStyleOf`, `commonYamlStyle`) |
| `packages/merge-core/src/merge-tree.ts` | **nouveau** — `MergeContext` : fusion récursive (mapping, liste identifiée, liste alignée par `diff3`), réconciliations, blocs d'ordre ; `mergeTree`, `mergeObject` (façade) |
| `packages/merge-core/src/output.ts` | **nouveau** — sortie à régions à toute profondeur (`dumpWithRegions`), listes `!!seq`, `updateOutputAt` |
| `packages/merge-core/src/flat-tree.ts` | **nouveau** — arbres d'affichage fusionnés à plat, conflit de position `pos:<id>` |
| `packages/merge-core/src/drawio.ts` | **nouveau** — `.drawio` par page (`parseDrawio`, `mergeDrawio`) |
| `packages/merge-core/src/diff-tree.ts` | **nouveau** — diff 2 voies (`diffTree`, `alignSequences`), détection des déplacements |
| `packages/merge-core/src/index.ts` | analyse unique des côtés, `detectKind` étendu (`yaml`, `trees`, `drawio`), `mergeFile` sur le moteur, `parseOutput`, `canonicalOutput` |
| `packages/merge-core/src/markers.ts` | `resolveRegion` traite toutes les régions d'une clé ; `canTakeBoth`, `resolveRegionBoth` |
| `packages/merge-core/src/object.ts`, `keyed.ts`, `units.ts`, `types.ts` | anciens algorithmes retirés (portés par le moteur) ; `updateObjectOutput` → `updateOutputAt` ; `FileKind` étendu |
| `packages/types/src/merge-resolution.ts` | `MergeFileKind` étendu, `MergeFileEntry.counts`, code `invalidDrawio` |
| `apps/desktop/src/main/services/merge-resolution.service.ts` | compteurs par fichier, validation `.drawio`, sortie canonique à la finalisation |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | message `invalidDrawio` |
| `packages/merge-core/src/generic.test.ts`, `apps/desktop/src/main/services/merge-resolution.gh222.test.ts` | **nouveaux** tests |

## Comportement implémenté

- Tout YAML écrit par l'app (`lineWidth: 120` ou style Suivi) est fusionné **structurellement** :
  deux changements sur des nœuds différents ne sont plus en conflit (schéma, requêtes, dashboards,
  `polenta-repo.yaml`…). Un YAML non canonique (commentaire, autre mise en forme) reste fusionné
  ligne à ligne.
- Objets : comportement GH37 conservé (clés `title`, `fields.<nom>`) ; en plus, étapes fusionnées
  une à une (`steps~<n>`, `order` renuméroté), runs de campagne par `entryId` (`runs~<id>`),
  `testCaseIds` par valeur.
- Liens / paramètres : inchangés (`link:<id>`, `param:<nom>`), sur le moteur.
- Arbres d'affichage : déplacements de nœuds différents fusionnés ; même nœud placé à deux endroits
  → `pos:<id>` (deux régions, un choix) ; supprimé / modifié → `pos:<id>` ; cycle ou cas non
  représentable → un bloc sur `root`.
- `.drawio` : pages modifiées d'un seul côté reprises ; des deux côtés, fusion ligne à ligne
  d'abord, sinon bloc `page:<id>`.
- « Prendre les deux » : éléments de liste, texte multiligne, liste ; refusé pour un scalaire et
  quand les deux côtés portent le même élément identifié.
- Liste des fichiers en conflit : `counts` (blocs en conflit, blocs repris).

## Divergences par rapport au design

- Pas de `MergeNode` ni de `tree` dans `MergeFileDetail` : le renderer recalcule (design §3 mis à jour).
- Conflit d'ordre d'une liste identifiée : la liste entière devient le bloc `<clé>~order` (gauche
  / droite), les éléments n'y sont pas fusionnés un à un — cas rare, écriture simple et sûre.
- Arbres d'affichage : pas de bloc d'ordre — deux réordonnancements différents gardent l'ordre de
  la destination.
- `canonicalOutput` ne réécrit qu'au besoin (design §3 mis à jour, retour de revue de code).

## Revue de code

`/code-review` (medium) : 10 constats, tous corrigés avec un test de non-régression —
nœud d'arbre perdu sous un parent supprimé, supprimé / modifié silencieux dans un arbre, « Prendre
les deux » dupliquant un élément identifié, page `.drawio` vide avalant la suivante, faux conflit
de fin de page `.drawio`, clés de diff dupliquées dans une liste alignée, faux déplacements entre
listes sans rapport, réécriture systématique de la sortie, analyse répétée des côtés,
`orderedKeys` dupliqué.

## Tests

- `@polenta/merge-core` : 72 tests (38 existants inchangés + 34 nouveaux : M2–M24, non-régressions).
- `merge-resolution.gh222.test.ts` : M25 et finalisation sur un vrai repo.
- `pnpm test` : vert (un test de performance GH74 a dépassé son budget sous `turbo` en parallèle,
  vert en exécution isolée — sans lien avec ce sprint) ; `pnpm lint`, typecheck : verts.

## Comment tester manuellement

Pas d'UI nouvelle à ce sprint. Sur deux branches, modifier `.polenta/schema.yaml` à deux endroits
différents (ex. un statut ajouté d'un côté, un libellé de champ changé de l'autre) puis merger
depuis la vue graphe : aucun conflit, les deux changements sont dans le résultat.
