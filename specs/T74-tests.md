# T74-tests — Éditer / retirer un composant ou une interface (Sprint 1)

Fixture de référence : `C:\Dev\polenta-prj2` (racine + `HMI`, `BMS`, `iface-bus-uart`,
`comp-controller` implémentant `iface-bus-uart` en rôle `master`, `comp-sensor` en rôle `slave`).

---

## Scénarios nominaux (golden path)

### S1 — Éditer la branche d'un composant

1. Onglet Structure → crayon "Modifier la dépendance" sur `comp-controller`.
2. Modale pré-remplie : url = URL actuelle (lecture seule), name = `comp-controller` (lecture
   seule), branche = `main`.
3. Changer la branche vers une autre branche existante du repo `comp-controller`, Enregistrer.

**Attendu** : `polenta-repo.yaml` du parent (`polenta-prj2`) a le `pin` mis à jour pour l'entrée
`comp-controller`, une seule entrée (pas de doublon). L'arbre se recharge, le nouveau pin résolu
s'affiche à côté du nom du repo.

### S2 — Éditer les rôles d'une interface

**Important** : le crayon "Modifier la dépendance" n'affiche le champ Rôles que sur le nœud de
l'**interface elle-même** (`node.isInterface === true`), jamais sur un composant qui
l'implémente — les rôles édités sont ceux que le **parent direct dans l'arbre** déclare pour
cette interface (symétrique à l'ajout via "+ Interface", qui écrit `implements` sur le nœud
courant au moment de l'ajout). Dans `polenta-prj2`, `comp-controller`/`comp-sensor` déclarent
leurs rôles pour `iface-bus-uart` dans leur **propre** schéma, indépendamment de la position de
`iface-bus-uart` dans l'arbre (ils ne sont pas son parent direct) — ce cas-là n'est **pas**
éditable par ce sprint (voir Hors scope de `T74.md`).

1. Ajouter une interface de test via le flux existant (T70) : sur `comp-controller`, "+" →
   "+ Interface", repo = une URL de test, nom = `iface-test`, branche = `main`, rôles = `slave`.
2. Crayon "Modifier la dépendance" sur le nœud `iface-test` nouvellement ajouté (son parent dans
   l'arbre est bien `comp-controller`, celui qui l'a ajoutée).
3. Modale pré-remplie avec `roles: slave`. Changer en `slave, master`, Enregistrer.

**Attendu** : `implements[].roles` de `comp-controller` (le parent) pour l'entrée
`interface: iface-test` devient `[slave, master]` — corrigée en place, pas de doublon d'entrée.

### S2bis — Éditer les rôles d'une interface qui n'a pas encore de déclaration `implements` côté parent

1. Retirer manuellement (édition du fichier ou via T74 lui-même) l'entrée `implements` créée en
   S2, en gardant `iface-test` dans l'arbre.
2. Rouvrir le crayon sur `iface-test` → champ Rôles vide (aucune entrée trouvée), saisir `device`,
   Enregistrer.

**Attendu** : une nouvelle entrée `{interface: iface-test, roles: [device]}` est **créée** dans
`implements[]` du parent — pas de no-op silencieux (cf. bug corrigé pendant ce sprint : la
première implémentation utilisait `.map()`, qui ne fait rien si aucune entrée ne correspond déjà).

### S2ter — Éditer vers une branche invalide ne détruit jamais le clone existant (correctif sécurité)

**Contexte** : bug trouvé en vérification live de S1 — `buildTree()` clonait par-dessus un repo
déjà présent dès que le pin demandé n'était pas résolvable localement, détruisant `.git` avant de
découvrir que la branche/tag n'existe pas sur le remote. Corrigé via `SyncService.fetch()` +
`WorkspaceTreeService.hasGitDir()` (cf. `T74-design.md` §2.8).

1. Sur un composant déjà cloné localement (ex. `comp-controller`), éditer la branche vers un nom
   qui n'existe ni localement ni sur le remote.
2. Enregistrer.

**Attendu** :
- Message d'erreur explicite dans la modale ("branche/tag introuvable" ou l'erreur réseau/HTTP
  remontée par le fetch), modale reste ouverte.
- Le répertoire `.git` de `comp-controller` **existe toujours** après l'échec — ni supprimé ni
  réinitialisé.
- `git log`/`git branch --show-current` dans `comp-controller` montrent l'historique et la
  branche **inchangés** par rapport à avant la tentative.
- `polenta-repo.yaml` du parent conserve le pin d'origine (`main`), pas la valeur invalide
  tentée — rollback déjà garanti par `addDependency()` (T70), vérifié ici qu'il reste correct
  après le correctif.

### S3 — Retirer un composant sans supprimer le dossier

1. Icône "Retirer" sur `HMI`.
2. Modale de confirmation, case "Supprimer aussi le dossier local" **non cochée**, confirmer.

**Attendu** : `HMI` disparaît de `polenta-repo.yaml → dependencies[]` du parent et de l'arbre
affiché. Le dossier `polenta-prj2/HMI/` reste présent sur disque.

### S4 — Retirer un composant avec suppression du dossier

1. Icône "Retirer" sur `BMS`, cocher "Supprimer aussi le dossier local", confirmer.

**Attendu** : `BMS` disparaît de l'arbre ET le dossier `polenta-prj2/BMS/` n'existe plus sur
disque.

### S5 — Retirer une interface nettoie la déclaration `implements` du parent

1. Retirer `iface-bus-uart` (sans cocher suppression disque, pour l'isoler du cas S4).

**Attendu** : `iface-bus-uart` disparaît de l'arbre. **Mais** `comp-controller` et `comp-sensor`
restent dans l'arbre (ce sont des dépendances directes de la racine, pas des enfants de
`iface-bus-uart`) — seule la déclaration `implements: [{interface: iface-bus-uart, ...}]` côté
racine (le parent qui avait ajouté l'interface) disparaît de son `schema.yaml`. Les composants
`comp-controller`/`comp-sensor` gardent leur propre `implements` pointant vers un mount qui n'est
plus dans l'arbre — état attendu et documenté en hors-scope (T74.md), pas un bug : ils
redeviendraient cohérents si `iface-bus-uart` est rajoutée sous le même nom.

---

## Cas limites

### L1 — Échec de rebuild n'efface jamais le dossier

Simuler un échec de `rebuildTree` après le retrait de la référence (ex. répertoire workspace
temporairement inaccessible) avec la case "supprimer le dossier" cochée.
**Attendu** : le dossier local n'est **pas** supprimé (la suppression ne se déclenche que sur
`result.status === 'ok'`) — seule la référence dans le manifeste a été retirée à ce stade,
comportement récupérable (l'entrée peut être rajoutée).

### L2 — Modifier la branche vers une branche/tag inexistant

1. Éditer `comp-controller`, saisir une branche qui n'existe pas sur le remote, Enregistrer.

**Attendu** : même comportement que l'ajout (T70 UC-2) — `parse-error` explicite ("La
branche/tag … est introuvable sur …"), le `pin` précédent reste inchangé dans
`polenta-repo.yaml` (déjà garanti par `addDependency()`, qui ne réécrit le manifeste qu'après
validation du rebuild).

### L3 — Retirer un repo qui a lui-même des enfants dans l'arbre

Retirer un composant qui déclare ses propres dépendances (repo avec son propre
`polenta-repo.yaml`).
**Attendu** : les sous-dépendances disparaissent aussi de l'arbre affiché (plus aucun chemin ne
les atteint depuis la racine), sans action explicite dessus — pas de suppression en cascade de
leurs propres entrées `polenta-repo.yaml`/dossiers (hors scope, cf. T74.md).

### L4 — Rôles vides après édition

Éditer les rôles d'une interface et laisser le champ vide, Enregistrer.
**Attendu** : `implements[].roles` devient `[]` — signifie "aucun rôle spécifique déclaré", donc
plus aucune exigence spécifique-rôle de l'interface n'est applicable à ce composant (seules les
exigences communes, `roles: []` côté interface, restent applicables). Pas un état d'erreur.

### L5 — Deux composants root n'ont pas de crayon/icône retrait

Vérifier que le nœud racine du workspace (`polenta-prj2` lui-même) n'affiche ni crayon
"Modifier la dépendance" ni icône "Retirer" (`parentRepoPath` est `undefined` pour ce nœud).

---

## Critères d'acceptation (repris de T74.md, sprint 1 uniquement)

- [ ] S1, S2 : édition branche et rôles fonctionnent sans dupliquer d'entrée.
- [ ] S3, S4 : retrait avec et sans suppression disque se comportent différemment comme attendu.
- [ ] S5 : nettoyage `implements` automatique pour une interface retirée.
- [ ] L1 : jamais de suppression disque si le rebuild échoue.
- [ ] L2 : branche invalide ne corrompt pas le manifeste existant.
- [ ] L5 : racine jamais éditable/retirable comme dépendance.
