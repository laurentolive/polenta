# T135 — Scénarios de test

Découpés par sprint, cf. `T135-design.md`.

## Sprint 1 — Réordonnancement par drag, même parent

### Golden path

1. Ouvrir l'onglet Structure d'un projet ayant un nœud avec ≥ 3 éléments (types
   exigence/test/campagne).
2. Vérifier qu'aucun bouton ↑/↓ n'apparaît plus sur les lignes `ElementLeaf`/`RepoRow`.
3. Glisser le 1er élément après le 2e → l'ordre affiché change immédiatement, sauvegarde
   automatique (comme avant avec les boutons).
4. Rouvrir l'onglet Structure (ou recharger le projet) → le nouvel ordre est bien persisté dans
   `schema.yaml`.
5. Répéter 3-4 pour un `RepoRow` (composant/interface monté) avec ≥ 2 frères, puis pour une
   `LocalNodeRow` (composant local) avec ≥ 2 frères — même comportement dans les trois cas.

### Cas limites

- **Un seul élément dans la liste** : rien à réordonner, pas de crash, pas de zone de dépôt
  affichée sur soi-même.
- **Glisser puis relâcher hors de toute zone de dépôt valide** (ex. en dehors de l'arbre) : aucun
  changement, l'ordre reste identique à avant le drag.
- **Glisser un élément sur lui-même** : no-op, pas de sauvegarde inutile.
- **Glisser rapidement plusieurs fois d'affilée** : chaque dépôt persiste avant le suivant (pas de
  race condition visible entre deux sauvegardes de schéma qui se chevauchent).
- **`LocalNodeRow` fermée (T131) pendant un drag d'un de ses éléments** : le drag d'un
  `ElementLeaf` interne à une `LocalNodeRow` repliée n'est pas concerné (contenu masqué, pas
  d'accès) — pas de régression sur le collapse/expand T131.
- **Composant local sans aucun frère** (seul enfant de son parent) : pas de zone de dépôt de
  réordonnancement affichée (rien avec quoi échanger de place).

## Sprint 2 — Changement de parent pour composants/interfaces et composants locaux

### Golden path

1. Glisser un `RepoRow` (composant monté) depuis son parent actuel vers un autre nœud "dossier"
   (un autre composant, ou une `LocalNodeRow`) → la dépendance disparaît de l'ancien parent,
   apparaît sous le nouveau, avec son pin/branche inchangés.
2. Glisser une `LocalNodeRow` (composant local, avec au moins un élément et un sous-composant
   propre) vers un autre nœud "dossier" → tout son sous-arbre (éléments, enfants imbriqués,
   dépendances propres) se retrouve intact sous le nouveau parent, rien n'est dupliqué ni perdu
   dans l'ancien emplacement.
3. Glisser une `LocalNodeRow` vers le niveau racine (hors de tout parent local) → devient un
   composant local de premier niveau (frère de `root`), même rendu qu'un composant créé
   directement à ce niveau.

### Cas limites

- **Anti-cycle** : glisser une `LocalNodeRow` sur elle-même, ou sur un de ses propres
  sous-composants (à n'importe quelle profondeur) → aucune zone de dépôt valide ne s'affiche ; si
  le drop survient malgré tout (event race), l'arbre reste inchangé.
- **`RepoRow` déplacé qui déclare implémenter une interface** (`implements` non vide sur son
  ancien parent) : après déplacement, le nouveau parent porte la même déclaration `implements`
  avec les mêmes rôles — pas de perte silencieuse du rôle joué.
- **Diamond-conflict au moment du déplacement** (le nouveau parent a déjà, par un autre chemin,
  une version différente du même repo épinglée) : la modale `DiamondConflictModal` existante
  s'affiche, comme pour un ajout de dépendance normal ; annuler laisse l'arbre dans son état
  d'avant le drag (pas de dépendance orpheline retirée de l'ancien parent sans être ajoutée au
  nouveau).
- **Nom déjà utilisé à la destination** : impossible en pratique (noms uniques sur tout le
  workspace/arbre local, cf. T135.md points 12/16) — pas de nouveau test de collision à écrire,
  seulement vérifier qu'aucune régression n'apparaît sur les gardes déjà en place.
- **Déplacer un composant local qui est actuellement replié (T131)** : le déplacement fonctionne
  identiquement qu'il soit ouvert ou fermé ; son état ouvert/fermé après déplacement est cohérent
  avec le comportement T131 (redevient ouvert par défaut si l'arbre est remonté).

## Sprint 3 — Changement de parent pour les éléments (types), cascade `objectTypeRef`

### Golden path

1. Créer une exigence sous un nœud A (composant local ou root), avec un `objectTypeRef` du type
   `A::exigence`.
2. Glisser le type `exigence` de A vers un nœud B **du même repo**.
3. Vérifier : le type n'apparaît plus dans les éléments de A, apparaît dans ceux de B ; l'exigence
   créée à l'étape 1 a désormais `objectTypeRef: B::exigence` (fichier réécrit) ; elle reste
   visible/éditable normalement (plus aucune trace de `A::exigence`).
4. Répéter avec un cas de test au lieu d'une exigence — la cascade doit couvrir les deux
   catégories.
5. Vérifier qu'aucune exigence/test **non concerné** (objectTypeRef différent) n'a été modifié par
   l'opération.

### Cas limites

- **Nœud destination appartenant à un repo différent** (le `root` d'un `RepoRow` d'un autre repo,
  ou un composant local imbriqué dans ce repo-là) : ce nœud ne s'illumine jamais comme cible de
  dépôt valide pendant ce drag précis — comportement volontairement restreint (cf. T135-design.md
  §Sprint 3), pas une régression à corriger.
- **Aucune exigence/test existant pour ce type** (type créé mais jamais instancié) : le
  déplacement se limite à la mutation de `schema.yaml`, aucune cascade à exécuter, pas d'erreur.
- **Grand nombre d'exigences/tests référençant le type déplacé** : la cascade traite chacun
  individuellement en best-effort (comme la cascade `implements[]` de `renameDependency`) — un
  fichier illisible/corrompu n'empêche pas la réécriture des autres ; erreur agrégée/affichée à
  l'utilisateur en fin d'opération si au moins un fichier a échoué.
- **Le type déplacé a un `prefix`** : le prefix ne change pas (règle projet : unique sur tout le
  projet, indépendant du nœud porteur) — seul le `nodeName` dans `objectTypeRef` change, jamais le
  `typeName`/`prefix`.
- **Campagnes** : vérifier qu'aucune campagne ne référence directement un `objectTypeRef` de type
  exigence/test (elles référencent des tests par ID, pas par type) — confirmer qu'aucune cascade
  n'est nécessaire côté campagnes avant de clore le sprint.
- **Annulation en cours de cascade** (fermeture de l'app / crash pendant la réécriture des
  fichiers) : cas limite accepté comme risque résiduel, cohérent avec l'absence générale de
  transaction multi-fichiers dans le reste de l'app (`renameDependency` a le même risque) — pas de
  mécanisme de rollback à développer pour ce ticket.

## Critères d'acceptation vérifiables

Repris de `T135.md` §Critères d'acceptation, à répartir par sprint selon `T135-design.md` — le
sprint final (3) revérifie l'intégralité de la liste avant clôture du ticket.
