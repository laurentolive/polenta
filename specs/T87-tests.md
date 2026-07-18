# T87 — Scénarios de test

## Scénarios nominaux (golden path)

### T87-01 — Édition directe sur `int-*`
1. Repo root checkouté sur sa branche d'intégration configurée (`int-v1`), aucune modification en
   attente.
2. Ouvrir une exigence, modifier un champ (ex. `statement`), attendre la sauvegarde auto.
3. **Attendu** : sauvegarde réussie (pas d'erreur, pas de blocage), fichier modifié sur disque,
   aucune branche créée (`sync:branches` inchangé), bouton "Publier" passe de désactivé à activé.

### T87-02 — Publier depuis `int-*` (mode nominal)
1. Suite de T87-01 (modification en attente sur `int-v1`, branche d'intégration configurée de ce
   repo).
2. Cliquer "Publier" → popup titre → saisir un titre → valider.
3. **Attendu**, dans l'ordre observable via le panneau Version / `sync:branches` :
   - une branche `dev-<slug-du-titre>` est créée puis supprimée (transitoire — vérifiable en
     observant `sync:status`/`sync:branches` pendant l'opération si le test est instrumenté, sinon
     seulement l'état final)
   - un commit existe dans l'historique de `int-v1` avec le titre saisi comme message (merge commit
     `Merge branch 'dev-<slug>' into int-v1` + le commit de contenu dessous)
   - le repo est re-checkouté sur `int-v1`
   - le contenu modifié à l'étape T87-01 est bien présent sur `int-v1` après publication
   - un push vers `origin` a été déclenché pour `int-v1` (vérifiable via l'historique du remote de
     test, ou via le mock/spy de `sync:push-branch` selon l'infra de test disponible)
   - `pendingChangesCount` repasse à 0, "Publier" redevient désactivé

### T87-03 — Publier depuis une branche `dev-*` ou libre créée manuellement (mode avancé)
1. Depuis le panneau Version, créer manuellement une branche `dev-manuel` (pas via "Publier"), ou
   une branche à nom libre type `experiment-x`.
2. Éditer une exigence.
3. Cliquer "Publier" → popup titre (sert de message de commit) → valider.
4. **Attendu** :
   - pas de branche intermédiaire créée — le commit se fait directement sur `dev-manuel`
   - merge de `dev-manuel` réussi vers la branche d'intégration configurée du repo
   - push de la branche d'intégration vers `origin`
   - le repo **reste checkouté sur `dev-manuel`** après publication (pas de checkout vers
     l'intégration)
   - `dev-manuel` **n'est pas supprimée** (l'utilisateur qui l'a créée en reste responsable —
     décision confirmée, plus une question ouverte)

### T87-03b — "Publier" bloqué depuis une autre branche `int-*`
1. Repo dont la branche d'intégration configurée est `int-v1`.
2. Checkout une autre branche `int-*` existante (ex. `int-v0`, une ancienne branche d'intégration
   non supprimée) depuis le panneau Version.
3. **Attendu** :
   - l'édition reste possible (sauvegarde locale fonctionne, comme sur n'importe quelle branche)
   - `ModificationControl` affiche `mode === 'blocked'` : pas de bouton "Publier", message
     informatif expliquant que cette branche n'est pas la branche d'intégration configurée du repo
   - aucune action de merge/push n'est possible depuis ce composant dans cet état

### T87-04 — Panneau Version, indicateur d'état
1. Repo sur `int-v1`, aucune modification en attente.
2. **Attendu** : aucun badge "Lecture seule" affiché (le detached HEAD est la seule condition qui
   l'affiche désormais).

## Cas limites

### T87-05 — Aucune modification, clic sur Publier impossible
1. Repo sur `int-v1`, `pendingChangesCount === 0`.
2. **Attendu** : bouton "Publier" visible mais désactivé (`disabled`), pas de popup accessible.

### T87-06 — Repo en detached HEAD (baseline)
1. Depuis le panneau Version, checkout un tag de baseline (ou un commit arbitraire).
2. Tenter d'éditer un champ d'exigence.
3. **Attendu** : édition bloquée, comme avant ce ticket (`readOnly` toujours vrai dans ce cas) —
   aucune régression.
4. `ModificationControl` : `mode === 'other'`, composant non affiché (pas de bouton "Publier").

### T87-07 — Publier avec conflit de merge
1. Provoquer un conflit (ex. modifier le même champ sur `int-v1` directement puis, dans une autre
   session/checkout, avoir une modification concurrente déjà mergée entre-temps — ou simuler via
   modification manuelle du fichier sur la branche d'intégration avant de publier).
2. Cliquer "Publier".
3. **Attendu** : `publishError` affiché avec le message générique + liste des fichiers en conflit ;
   l'utilisateur reste sur la branche `dev-*` créée à l'étape de publication (pas de perte du
   commit) ; bouton "Résolution manuelle (Version)" navigue vers `/version-diff` scopé au bon repo.
4. Vérifier que les modifications commitées sur `dev-*` sont toujours présentes (pas de rollback
   silencieux).

### T87-08 — Édition puis navigation sans publier
1. Repo sur `int-v1`, éditer un champ (sauvegarde locale).
2. Naviguer vers un autre élément puis revenir, sans cliquer "Publier".
3. **Attendu** : la modification est toujours présente (relue depuis le fichier sur disque), le
   compteur de modifications en attente reste > 0, "Publier" reste actif.

### T87-09 — Checkout d'une autre branche avec modifications en attente sur `int-*`
1. Repo sur `int-v1`, modification en attente.
2. Depuis le panneau Version, checkout une autre branche (ex. `main` ou un tag).
3. **Attendu (comportement natif isomorphic-git, pas de garde applicative ajoutée par ce ticket)** :
   succès si aucun conflit de fichier entre la modification en attente et la cible (les
   modifications suivent alors sur la nouvelle cible — potentiellement déroutant mais volontairement
   non bloqué, décision explicite du ticket) ; erreur native isomorphic-git affichée telle quelle
   sinon. Documenté comme hors scope dans `T87.md` — ce scénario sert à vérifier qu'aucune
   régression silencieuse n'apparaît (pas de perte de données non signalée : soit le checkout
   réussit et les modifications sont préservées sur la nouvelle branche, soit il échoue et
   l'utilisateur reste sur `int-v1` avec ses modifications intactes).

### T87-09b — Échec du push après un merge réussi
1. Repo sur `int-v1`, modification en attente, remote configuré mais injoignable (ou divergé côté
   remote pour provoquer un rejet).
2. Cliquer "Publier".
3. **Attendu** : le merge local a bien lieu (visible dans l'historique local, checkout intégration
   effectué dans le cas nominal), une erreur non bloquante signale l'échec du push spécifiquement
   (distincte du message de conflit de merge), l'utilisateur reste dans l'état post-merge —
   aucune tentative de rollback du merge local.

### T87-10 — Création de baseline bloquée par des modifications en attente
1. Repo sur `int-v1`, modification en attente (non publiée).
2. Tenter de créer une baseline (T79).
3. **Attendu** : blocage non contournable, le repo est listé avec la raison "modifications en
   attente" — comportement T79 §5.2 inchangé, aucune régression introduite par ce ticket.

### T87-11 — Non-régression : correctif `createBranch` sans perte de fichier
1. Repo sur `int-v1`, modifier plusieurs champs sur plusieurs exigences (plusieurs fichiers
   modifiés/non commités).
2. Cliquer "Publier".
3. **Attendu** : tous les fichiers modifiés (pas seulement le dernier édité) se retrouvent dans le
   commit publié sur `int-v1` — vérifie que `sync:create-branch` (via `noCheckout: true`) ne perd
   aucune modification, y compris sur des fichiers autres que celui affiché à l'écran au moment du
   clic.

## Critères d'acceptation vérifiables

- [ ] T87-01 à T87-04 passent (golden path)
- [ ] T87-03b passe (blocage "Publier" sur `int-*` non concordante, édition non affectée)
- [ ] T87-05, T87-06 passent (blocages attendus préservés)
- [ ] T87-07 passe (conflit géré sans perte de travail, pas de push tenté)
- [ ] T87-08 passe (persistance locale avant publication)
- [ ] T87-09 ne révèle aucune perte de données silencieuse
- [ ] T87-09b passe (échec de push non bloquant, merge local préservé)
- [ ] T87-10 passe (T79 non régressé)
- [ ] T87-11 passe — critique : valide le correctif `SyncService.createBranch` (`noCheckout: true`)
      qui est la condition de sécurité de tout le ticket
- [ ] Aucun bouton "Faire une modification" ni "Annuler" visible nulle part dans l'UI
- [ ] Aucun badge Lecture/Édition visible dans `ModificationControl`
