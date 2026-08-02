# T135 — Sprint 2

## Fichiers modifiés

- `packages/types/src/schema-tree.ts` — nouvelles fonctions exportées :
  - `isDescendant(nodes, ancestorName, candidateName)` — vrai si `candidateName` est
    `ancestorName` lui-même ou vit dans son sous-arbre.
  - `moveSystemNode(nodes, name, toParentName)` — déplace un composant local (avec tout son
    sous-arbre) pour devenir le dernier enfant de `toParentName` (ou un frère de premier niveau de
    `root` si `toParentName` est `null`). No-op si `name === toParentName`, si `toParentName` est
    un descendant de `name` (anti-cycle), ou si `toParentName` n'existe plus dans l'arbre (garde
    anti-perte-de-données, cf. Revue de code).
- `apps/desktop/src/renderer/lib/workspaceActions.ts` :
  - `moveDependencyToParent(workspaceDir, fromParentRepoPath, toParentRepoPath, toLocalParent, dep)`
    — nouvelle fonction : `removeDependency` (sans supprimer le dossier cloné) suivi de
    `addDependency` sur le nouveau parent ; préserve toute déclaration `implements[]`/rôles que le
    parent source portait pour cette dépendance.
  - `removeDependency` — étendu pour nettoyer aussi `nodes[root].implements` (pas seulement le
    champ fichier déprécié `schema.implements`), cf. Revue de code.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` :
  - Nouveau type `ReparentTarget` (`{repoPath, name: string | null}`) et `sameReparentTarget`.
    `DropTarget` est maintenant une union : réordonnancement (`DragItem & {position:'before'|'after'}`,
    sprint 1) ou reparenting (`ReparentTarget & {position:'into'}`, sprint 2).
  - `DragRow` : accepte maintenant `item: DragItem | null` (root n'a pas d'identité de
    réordonnancement mais reste une cible de dépôt valide), `reparentTarget: ReparentTarget | null`,
    `canDropInto` (callback, pas un booléen précalculé — cf. Revue de code). Gère trois zones de
    survol quand une ligne est à la fois un frère réordonnable ET une cible de reparenting valide
    (tiers haut/bas = réordonner, tiers central = devenir parent) — cf. Revue de code.
  - `RepoRow`/`LocalNodeRow` : toujours enveloppés dans `DragRow` (plus de branche `<div>` séparée
    pour root), exposent chacun leur propre `reparentTarget`.
  - Nouveaux handlers `handleReparentLocalComponent`, `handleReparentDependency`, `canDropInto`,
    `isWorkspaceDescendant`, `sameDropTarget` ; `handleDropRow` dispatche d'abord sur
    `to.position === 'into'` avant de retomber sur le réordonnancement du sprint 1.

## Comportement implémenté

Conforme à `specs/T135.md` points 7-12 et 14-16 (changement de parent pour composants montés et
composants locaux) et `specs/T135-design.md` §Sprint 2. Glisser un `RepoRow`/`LocalNodeRow` sur un
autre nœud "dossier" (y compris le workspace root) le déplace : composant local → nouveau parent
dans `schema.yaml` (ou promotion au niveau racine) ; dépendance montée → nouveau
`polenta-repo.yaml` parent, avec `localParent` posé si la cible est un composant local. Anti-cycle
pour les deux cas.

## Divergences par rapport au design

1. **`moveSystemNode` n'a pas de paramètre `toIndex`.** `specs/T135-design.md` proposait
   `moveSystemNode(nodes, name, toParentName, toIndex)`. Implémenté sans lui : le nœud déplacé est
   toujours ajouté en dernière position parmi les enfants de sa nouvelle destination — repositionner
   précisément se fait ensuite via le réordonnancement du sprint 1 (glisser-déposer déjà disponible
   dans la nouvelle liste de frères), pas en une seule opération. Simplifie l'implémentation sans
   perte de capacité réelle.
2. **`isWorkspaceDescendant` (anti-cycle pour les dépendances montées) n'était pas prévu par le
   design.** `specs/T135-design.md` ne documentait un anti-cycle que pour `LocalNodeRow`
   (`isDescendant`). En écrivant le code, le même risque est apparu évident côté dépendances :
   glisser un `RepoRow` sur l'un de ses propres dépendants (transitifs) le ferait dépendre de
   lui-même. Ajouté par prudence, sans qu'aucun scénario de `specs/T135-tests.md` ne le couvre
   explicitement — testé manuellement (cf. Vérifications effectuées).

## Revue de code

`/code-review` (8 angles) a trouvé et vérifié plusieurs problèmes avant validation finale — plus
nombreux et plus sérieux qu'au sprint 1, car le changement de parent touche des invariants plus
profonds (cascade multi-fichiers, anti-cycle, préservation de données à travers un
remove-puis-add) que le simple réordonnancement.

**Corrigés :**
1. **Perte de données dans `moveSystemNode`** — la fonction ne vérifiait pas que `toParentName`
   existait encore avant de retirer le nœud déplacé de l'arbre. `removeSystemNode` s'exécute
   inconditionnellement, et `mapSystemNode` ne fait *rien* silencieusement si sa cible est
   introuvable (par design, pour d'autres appelants qui savent déjà qu'elle existe) : si la ligne
   cible avait été supprimée entre-temps (course avec une suppression concurrente), le composant
   déplacé — et tout son sous-arbre (exigences, tests, sous-composants) — disparaissait
   définitivement, retiré de son ancien emplacement sans être réinséré nulle part. Corrigé en
   vérifiant l'existence de `toParentName` avant tout retrait.
2. **`moveDependencyToParent` ne restaure pas la source si l'ajout à la destination échoue** — si
   `removeDependency` réussit mais que `addDependency` échoue ensuite (diamond-conflict,
   parse-error), `addDependency` n'annule que *sa propre* écriture (côté destination) ; sans
   restauration explicite côté source, la dépendance disparaissait purement et simplement de tout
   le graphe de dépendances du workspace, au lieu de rester à sa place d'origine comme le
   glisser-déposer semblait le montrer. Corrigé : en cas d'échec de l'ajout, la dépendance est
   restaurée exactement à son ancien parent/`localParent`.
3. **Perte silencieuse de rôle d'interface pour une dépendance imbriquée sous un composant
   local** — `preservedRoles` ne lisait que le fichier ou le nœud `root`, jamais le nœud d'un
   composant local (`dep.localParent`), alors qu'un composant local peut porter son propre
   `implements` (T123) indépendamment de `root`. Corrigé en résolvant le bon nœud déclarant
   (`root` ou le composant local nommé `dep.localParent`) avant de lire/préserver le rôle.
4. **`removeDependency` ne nettoyait que `schema.implements` (champ fichier déprécié), jamais
   `nodes[root].implements`** — un bug préexistant (pas introduit par ce sprint), mais qui rendait
   directement incorrecte la garantie de `moveDependencyToParent` : après un déplacement, l'ancien
   parent gardait une déclaration `implements` périmée pour une interface qu'il ne dépend plus.
   Corrigé en étendant le nettoyage aux deux emplacements (même convention "fichier d'abord, nœud
   en repli" déjà utilisée ailleurs dans ce fichier). Ce correctif touche aussi le chemin de
   suppression simple (sans reparenting) — jugé dans le périmètre de ce ticket car
   `moveDependencyToParent` en dépend directement pour être correct.
5. **"Nicher sous un frère" était inatteignable depuis l'UI** — quand une ligne est à la fois un
   frère réordonnable et une cible de reparenting valide, le survol résolvait toujours vers
   réordonner (avant/après), ne laissant aucun moyen de nicher un élément sous son propre frère
   directement. Corrigé par un survol en tiers (haut/bas = réordonner, milieu = nicher) quand les
   deux sont valides simultanément.
6. **Dépôt "into" redondant sur le parent déjà actuel** — `canDropInto` acceptait de déplacer un
   élément vers son propre parent actuel, déclenchant un aller-retour `removeDependency`+
   `addDependency` (avec vérification diamond-conflict) pour un déplacement à effet nul,
   atteignable plus simplement via le réordonnancement du sprint 1. Corrigé en rejetant ce cas.

**Simplifications appliquées :**
7. `canReparentInto: boolean` (précalculé identiquement dans `RepoRow` et `LocalNodeRow`)
   remplacé par `canDropInto` passé en callback à `DragRow`, qui le calcule lui-même une seule
   fois — évite la duplication et le risque de désynchronisation entre les deux call sites.
8. `sameDropTarget` comparait ses deux arguments via un cast `as ReparentTarget` sur les deux côtés
   après un test `||` redondant (l'un des deux membres du `||` était déjà garanti par le test
   précédent). Remplacé par un rétrécissement de type par variable (même pattern que `DragRow`
   utilise déjà), sans cast.

**Examinés et écartés (pas de changement) :**
- Re-rendu de `canDropInto` (marche O(profondeur×largeur) via `isWorkspaceDescendant`) à chaque
  ligne à chaque `dragover` — coût réel mais transitoire (dure le temps du geste de drag), à
  l'échelle du projet (« une poignée de repos », CLAUDE.md) ; cohérent avec l'absence de
  mémoïsation déjà acceptée au sprint 1.
- Le composant local nommé promu au niveau racine via glisser-déposer atterrit toujours dans
  `schema.nodes` de premier niveau, jamais dans `rootNode.children` (même s'il en provenait) —
  changement de représentation de stockage silencieux mais sans effet visuel ni fonctionnel ;
  cohérent avec le compromis déjà noté au sprint 1 (`specs/T135-sprint1.md` note 4) sur cette
  même dualité de stockage, pas quelque chose que ce ticket doit résoudre.
- Emplacement de `canDropInto` (fermeture dans `StructureTab`, pas fonction pure exportée) — jugé
  correct : contrairement à `isDescendant`/`isWorkspaceDescendant` (déjà pures, déjà réutilisables),
  `canDropInto` a besoin de `schemasByRepoPath`/`flatNodes`/`tree`, propres au composant.

## Vérifications effectuées

- `tsc --noEmit` : `@polenta/desktop` et `@polenta/types` — 0 erreur.
- **Vérification manuelle dans l'app réelle** (build + driver Playwright `run-desktop`) : deux
  composants locaux créés (`compA`, `compB`) à la racine d'un projet de test.
  - Glisser `compB` sur `compA` (survol au centre de la ligne) → `compB` niché sous `compA`
    (confirmé par la profondeur d'indentation : 48px vs 32px), persisté après rafraîchissement.
  - Glisser `compB` (niché) sur la ligne racine du repo → promu au niveau racine (indentation
    revenue à 32px, frère de `compA`).
  - Re-niché `compB` sous `compA`, puis tenté de glisser `compA` sur `compB` (son propre
    descendant) : `dragover` ne déclenche `preventDefault()` sur aucune zone
    (`defaultPrevented=false`) — aucune cible de dépôt offerte, arbre inchangé après le drop.
    Anti-cycle confirmé fonctionnel en conditions réelles.
  - `RepoRow` (dépendance montée réelle, `moveDependencyToParent`) non retesté en direct dans ce
    sprint — nécessite un vrai repo Git dépendant, plus lourd à mettre en place que les composants
    locaux ; vérifié par relecture de code et par les corrections ci-dessus (points 2-4), qui
    ciblaient précisément cette fonction.

## Comment tester manuellement

1. Ouvrir l'onglet **Modèle de données → Structure** d'un projet avec au moins deux composants
   locaux frères.
2. Glisser l'un sur l'autre (survol au centre de la ligne cible) → le composant glissé devient
   niché sous l'autre (chevron, indentation supplémentaire).
3. Glisser le composant niché sur la ligne du repo (racine) → il remonte au niveau racine.
4. Essayer de glisser un composant sur l'un de ses propres sous-composants → aucune zone de dépôt
   ne s'affiche, rien ne se passe si on relâche quand même.
5. Avec un repo dépendant réel monté (`+ Composant`, décoché "Composant local", nécessite une URL
   Git) : glisser ce composant sur un autre nœud "dossier" → il change de parent dans
   `polenta-repo.yaml` ; si ce composant est aussi déclaré comme implémentant une interface
   (rôles), vérifier que ces rôles sont conservés sur le nouveau parent et absents de l'ancien.

## Note

Comme au sprint 1, la vérification manuelle a couvert le cas `LocalNodeRow` en direct (le plus
simple à mettre en place sans dépendance Git externe) ; `RepoRow`/`moveDependencyToParent` restent
à revérifier en direct avant fusion finale si le temps le permet — pas fait ici par manque de
temps, pas par choix délibéré. Les 4 corrections de la revue de code ciblant spécifiquement cette
fonction (préservation de rôle, restauration en cas d'échec, nettoyage de `removeDependency`) ont
été appliquées avec soin mais méritent un test en conditions réelles dès qu'un repo dépendant de
test est disponible.
