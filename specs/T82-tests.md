# T82 — Scénarios de test

## Scénarios nominaux (golden path)

1. **Checkout d'une branche sur un composant** : workspace root + composant `compA`
   (dépendance de root, pin actuel = `main`). Dans le panneau Version, ouvrir `compA`,
   checkout la branche `feature-x` via le combobox → `compA` est bien sur `feature-x` sur
   disque ; `polenta-repo.yaml` de root apparaît en Modifications (non stagé), avec
   `dependencies[].pin` pour `compA` = `feature-x`.

2. **Checkout d'un tag sur un composant** : même setup, checkout le tag `v1.2` → même
   comportement, `pin` = `v1.2`.

3. **Checkout d'un commit (SHA) sur un composant** : ouvrir le combobox de `compA` →
   "Checkout un commit…" → saisir un SHA valide existant sur `compA` → checkout réussi,
   `pin` de root pour `compA` = ce SHA (complet).

4. **No-op sur réf déjà pinnée** : `pin` actuel de `compA` = `feature-x`, checkout à
   nouveau `feature-x` (ou re-sélection de la branche déjà courante) → aucune entrée
   nouvelle dans Modifications de root.

5. **Checkout du root** : checkout une autre branche sur le dossier root lui-même →
   aucune écriture de pin nulle part (personne ne déclare root comme dépendance).

6. **Commit simple sans dépendant** : composant `compA` n'est référencé par aucun autre
   repo indirectement pertinent dans ce scénario (seul root le référence, cas déjà couvert
   par 1-3) — committer une modification quelconque dans `compA` (ex. une exigence) après
   avoir déjà committé le pin-bump de root séparément : pas de nouvelle proposition dans
   `compA` lui-même (rien ne déclare `compA` comme SA propre dépendance dans ce setup).

7. **Cascade sur deux niveaux (root → compA → compB)** : `compA` déclare `compB` comme
   dépendance (pin = SHA1). Checkout `compB` sur une nouvelle branche `dev-y` → `pin` de
   `compA` pour `compB` = `dev-y` (Modifications de `compA`, non stagé). Committer ce
   changement dans `compA` (bouton Committer, `compA` obtient un nouveau SHA2) → `pin` de
   root pour `compA` apparaît à son tour en Modifications (non stagé) = SHA2. Committer
   root ensuite (ou pas) reste au choix de l'utilisateur — pas de 3ᵉ niveau ici (root est
   la racine).

8. **Dépendance partagée (diamond sans conflit, même pin)** : une interface `iface-x` est
   dépendance à la fois de `compA` et de `compB` (root → compA, root → compB → iface-x
   et root → iface-x directement, même pin partout). Committer une modification dans
   `iface-x` → les DEUX repos qui la référencent (`compA`... en fait ici root et compB,
   selon le montage) reçoivent chacun la proposition de pin vers le nouveau SHA.

9. **"Publier" (T83) sur un composant** : ouvrir le mode édition sur `compA` (`?repo=`),
   "Faire une modification" → dev-\* créée → modifier une exigence → "Publier" (commit +
   merge dans `int-*` + checkout `int-*` + suppression `dev-*`) → le `pin` de root pour
   `compA` est proposé avec le SHA du **merge** (pas celui du commit intermédiaire sur la
   branche `dev-*` supprimée) — apparaît en Modifications de root, non stagé.

10. **Annuler la modification de pin proposée** : après le scénario 1, dans les
    Modifications de root, cliquer "Annuler" sur `polenta-repo.yaml` → le fichier revient
    à son contenu précédent (`pin` = `main`), disparaît de Modifications.

## Cas limites

- **Diamond-conflict déclenché par la propagation** : `iface-x` référencée par `compA`
  (pin = SHA1) et par root directement (pin = SHA2, déjà divergent avant toute action —
  état de désynchro pré-existant). Checkout `iface-x` sur un SHA3 → la mise à jour côté
  `compA` réussit (pas de conflit local), mais la proposition côté root échoue avec un
  rollback diamond-conflict (le rebuild y détecte deux pins différents pour la même URL,
  cf. `addDependency`) → root n'a **pas** de nouvelle modification en attente pour ce
  pin, et un avertissement distinct indique que la mise à jour a échoué pour ce repo
  précis (checkout de `iface-x` lui-même resté un succès).
- **Écriture échoue (fichier verrouillé/illisible)** : simuler une erreur d'écriture sur
  `polenta-repo.yaml` d'un dépendant (ex. droits fichier) → le checkout/commit source
  reste marqué comme un succès dans l'UI (composant bien sur la nouvelle réf / commit
  bien effectué), un message d'erreur séparé signale l'échec de la mise à jour du pin
  pour ce repo précis, sans bloquer les autres dépendants éventuels (best-effort).
- **Commit d'un repo qui n'est référencé nulle part** (composant "feuille" indépendant,
  jamais déclaré en dépendance dans ce workspace) : committer une exigence dedans → aucun
  balayage ne trouve de correspondance → aucune proposition, aucun repo supplémentaire
  n'apparaît "sale".
- **Multiples commits successifs avant toute propagation manuelle en cascade** :
  committer `compB` deux fois de suite (deux modifications distinctes) sans jamais
  committer `compA` entre les deux → le `pin` proposé dans `compA` reflète toujours le
  SHA du commit **le plus récent** de `compB` (la seconde proposition remplace la
  première, `compA` n'a qu'une seule modification en attente sur ce fichier, pas deux
  empilées).
- **`compA` a déjà des modifications non liées en attente au moment de la propagation**
  (ex. une exigence modifiée, non committée) : la proposition de pin s'ajoute comme
  modification supplémentaire sur `polenta-repo.yaml` (fichier distinct) sans toucher ni
  écraser les autres fichiers déjà modifiés de `compA`.
- **Checkout par commit avec un SHA syntaxiquement invalide** (pas hexadécimal, ou trop
  court) : le champ ne permet pas de valider (bouton désactivé), pas d'appel réseau/IPC
  inutile.
- **Checkout par commit avec un SHA hexadécimal valide mais inexistant dans le repo** :
  `api.sync.checkoutCommit` échoue → message d'erreur du combobox existant (pattern
  déjà utilisé pour les erreurs de checkout branche/tag), aucune proposition de pin
  n'est tentée (le checkout source a échoué).
- **Checkout/commit sur le repo root avec des composants par ailleurs sales** : aucune
  interférence — la logique ne s'applique qu'au repo effectivement checkouté/committé.
- **Création d'une branche `dev-*` (T83 "Faire une modification") ou toute autre
  `createBranch`** : ne déclenche jamais de proposition de pin, y compris si le composant
  concerné est une dépendance déclarée ailleurs (vérifier explicitement l'absence de
  bruit ici — régression la plus probable si `propagatePinToDependents` était câblé par
  erreur sur `createBranch`).

## Critères d'acceptation (repris de `T82.md`, formulés testables)

| # | Critère | Couvert par |
|---|---|---|
| 1 | Checkout branche composant → pin parent mis à jour | Nominal 1 |
| 2 | Checkout tag composant → pin parent mis à jour | Nominal 2 |
| 3 | Checkout commit (nouvelle UI) → pin parent mis à jour | Nominal 3, cas limites SHA invalide/inexistant |
| 4 | Pin apparaît en Modifications non stagées, jamais committé auto | Nominal 1, 2, 3, 7, 9 |
| 5 | No-op si réf déjà pinnée | Nominal 4 |
| 6 | Checkout root → aucune écriture | Nominal 5 |
| 7 | Commit d'un repo référencé propose la mise à jour dans le(s) dépendant(s) | Nominal 7 (niveau 1), 8 |
| 8 | Cascade récursive vers les grands-parents | Nominal 7 (niveau 2) |
| 9 | Commit root ou repo non référencé → pas de bruit | Nominal 6, cas limite "non référencé" |
| 10 | Annuler restaure l'ancien pin | Nominal 10 |
| 11 | Échec d'écriture signalé distinctement, action source non affectée | Cas limite "écriture échoue" |
| 12 | Diamond-conflict → rollback + avertissement, pas d'échec silencieux | Cas limite "diamond-conflict déclenché" |
