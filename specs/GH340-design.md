# GH340 — Design

Spec : `specs/GH340.md`. Deux sprints.

## 1. Principe

**Une seule règle**, appliquée au point d'écriture unique de chaque service : `updatedAt` /
`updatedBy` avancent quand **le contenu hors clés de l'application** change. Les clés de
l'application sont `history`, `needsRevalidation`, `version`, `objectTypeRef`, `projectId`,
`branchId` et les quatre champs d'audit.

Le tri « action utilisateur / écriture automatique » de la spec (§4.2, §4.3) découle de cette règle,
sans drapeau par appelant :

| Écriture | Ce qui change | Effet |
|---|---|---|
| Modification, transition, diff-edit, run ou décision d'issue | contenu | avance |
| Revalidation (T172) | `needsRevalidation` seul | rien |
| Déplacement (`retargetObjectTypeRef`, `tests.update` avec `objectTypeRef`) | `objectTypeRef` seul | rien |
| Renommages, adoption dans l'arbre, reprise GH77 | écriture `raw` | rien (valeurs relues et réécrites telles quelles) |
| Renommage de préfixe (GH100) | texte brut réécrit | rien (les champs font partie du texte) |

## 2. Fichiers

### 2.1 `main/services/audit-fields.util.ts` (réécrit)

`omitAuditFields` est supprimé. À la place :

- `APP_KEYS` : liste unique des clés de l'application. `version-tracking.service.ts` l'importe au
  lieu de garder sa propre copie.
- `contentChanged(before, after)` : compare la forme canonique, sans les `APP_KEYS`. Clés triées et
  clés `undefined` retirées, comme le `canonical` de `campaign-snapshot.util`, extrait ici et partagé.
- `applyAudit(before, after, by, at)` :
  - création (`before` null) : les quatre champs ;
  - contenu changé : `updatedAt` / `updatedBy`, et `createdAt` / `createdBy` repris de `before` ;
  - sinon : les quatre valeurs de `before`, inchangées.
- `auditForWrite(obj)` : retire les clés d'audit `null` ou `undefined`. Un fichier ne contient jamais
  `createdAt: null`.
- `readAuditFields(obj)` : normalise à la lecture. Une valeur `Date` (YAML édité à la main, non
  quoté) devient une chaîne ISO, une valeur absente devient `null`.

### 2.2 `HistoryService.stampAudit(repoPath, before, after)`

Nouvelle méthode. L'acteur et l'horloge vivent déjà dans `HistoryService` (`by` identique à
l'historique). L'acteur n'est résolu que si les dates changent, et `at` vaut
`historyTimestamp(now())`.

Les campagnes ne l'appellent pas : elles ont leurs propres dates.

### 2.3 Écritures

| Fichier | Changement |
|---|---|
| `requirements.service.ts`, `tests.service.ts` `persist` | non `raw` : `stampAudit` après `stamp`. Écriture `auditForWrite(stamped)` dans tous les cas, `raw` compris |
| `issues.service.ts` `persist`, `rewriteObjects` | idem |
| `revalidation.service.ts` `writeElement` | `stampAudit` (donne « rien », §1) puis `auditForWrite`. Cela garde le fichier cohérent si un jour la revalidation change autre chose |
| création (`create` des trois services) | les `null` d'aujourd'hui restent : `stampAudit` les remplit (`before` null) |

### 2.4 Lectures

- **Index** : `requirements-index.service.ts`, `tests-index.service.ts` et `issues.service.ts`
  (`getOrBuild`) remplacent `fileHistoryMap` par `readAuditFields(obj)`.
- **Lecture à un tag** : `req-refs.service.ts` `readAtTag` lit les champs du fichier au tag, de la
  même façon.
- **Suppression** : `GitService.fileHistoryMap` n'a plus d'appelant et disparaît. `fileHistory`
  reste, pour le repli des campagnes (`history.service`, `graph.service`).

### 2.5 Copies de campagne

`campaigns.service.ts` (lignes 155 et 763) : la copie devient `withoutCopyKeys(test)`, c'est-à-dire
`withoutHistory` plus le retrait des quatre champs. L'empreinte `testFingerprint` ne change pas.

### 2.6 Fusion — `packages/merge-core`

- `StructureDesc.reconcile` reçoit un 5ᵉ argument `roots: { l, r }`, les objets racine des deux
  côtés, conservés par `MergeContext.root()`. C'est nécessaire parce qu'un auteur suit sa date :
  `updatedBy` dépend des `updatedAt` des deux côtés.
- `OBJECT_DESC.reconcile` :
  - `updatedAt` : la plus récente ;
  - `updatedBy` : celui du côté dont `updatedAt` est le plus récent ;
  - `createdAt` : la plus ancienne ;
  - `createdBy` : celui du côté dont `createdAt` est le plus ancien.
- Une valeur absente d'un côté cède à l'autre. Les dates se comparent par `Date.parse`, chaîne ou
  `Date`.
- Les cas triviaux (un seul côté modifié) passent avant `reconcile`, comme aujourd'hui.

### 2.7 Reprise — mise en conformité (sprint 2)

- **`GitService.auditDatesFromHistory(repoPath, prefixes)`** : un seul parcours de `git.log` depuis
  HEAD.
  - Tous les parents sont parcourus, pas seulement le premier.
  - Pour chaque commit à **un seul parent**, les fichiers changés sous les préfixes (sous-arbres
    identiques élagués, comme `fileHistoryMap` aujourd'hui) ; pour le commit racine, tous ses
    fichiers.
  - Les commits de fusion sont ignorés : l'auteur est donc l'auteur réel.
  - Résultat par fichier : le plus ancien commit (création) et le plus récent (modification), par
    date d'auteur.
  - Remplacé par `git log --no-merges --name-only` dans #337.
- **`RepoConformityService`**, nouvel élément `audit-dates` (miroir dans `@polenta/api-client`) :
  - `check` : liste les fichiers `requirements/`, `tests/` et `issues/` à qui il manque au moins un
    des quatre champs. C'est un test textuel des clés de premier niveau (`^createdAt:` …), sans
    parsing, la vérification tournant toutes les 30 s.
  - `apply` : un appel à `auditDatesFromHistory` ; pour chaque fichier, lecture du YAML, ajout des
    seules clés absentes, réécriture (méthode `fillAuditDates`). Ensuite le commit et le push du flux
    existant. Les index se rafraîchissent par l'observateur de fichiers, comme pour les autres
    éléments.
  - Pas de proposition sur un dépôt en lecture seule : `ConformityNotice` ne s'affiche déjà pas en
    HEAD détaché, et `check` ne s'appelle pas.
- **Garde-fou** (`history.write-paths.test.ts`) : ajout de `repo-conformity.service.ts#fillAuditDates`
  à la liste autorisée. Justification : il n'écrit que des clés d'audit absentes et ne change aucune
  valeur suivie.
- **Interface** : `ConformityNotice` passe `count` à la traduction. Nouvelle clé
  `item_audit-dates` en fr et en en, par exemple « dates de création / modification de {{count}}
  objets, reprises de l'historique git ».

## 3. Écart avec la spec, corrigé dans `specs/GH340.md`

La spec disait : « Les quatre champs sont écrits ensemble ; un objet ne garde jamais une partie
seulement. » C'est impossible pour un objet non repris qu'on modifie : sans git, `createdAt` est
inconnu. Formulation corrigée :
- une valeur inconnue n'est jamais écrite (`null` n'apparaît jamais dans le fichier) ;
- l'objet reçoit `updatedAt` / `updatedBy` ;
- la reprise ajoutera `createdAt` / `createdBy` sans toucher au reste.

## 4. Alternatives écartées

- **Un drapeau « action utilisateur » passé par chaque appelant** : fragile (un appelant oublié), et
  la règle sur le contenu donne le même résultat (§1).
- **Dates posées dans `HistoryService.stamp`** : `stamp` sert aussi aux campagnes, qui ont leurs
  propres dates. Une méthode séparée évite un paramètre de plus.
- **Reprise à l'ouverture du dépôt, sans validation** : contraire à GH336 (aucune écriture
  versionnée sans validation).
- **`check` par lecture des index** : les index sont par repo ouvert et ne couvrent pas
  directement les composants. Le scan textuel est simple et borné.

## 5. Découpage

**Sprint 1 — écriture, lecture, fusion, docs**
- §2.1 à §2.6.
- Suppression de `fileHistoryMap`.
- Tests unitaires : `audit-fields.util`, services, index, `req-refs`, `merge-core`.
- Mesure de la reconstruction des index sur handstickProduct, avant et après.
- Docs :
  - `CLAUDE.md` (champs d'audit) ;
  - `agents-md.template.ts` ;
  - `SPEC-REQ` §3.4 et §4.4 ;
  - `SPEC-TESTS` §2.4a et la mention de l'export ;
  - `SPEC-TECH-stack` §4.2 et §6.6 ;
  - renvoi depuis `T112.md`.

**Sprint 2 — reprise**
- §2.7.
- Tests unitaires de `auditDatesFromHistory` (fusion, commit racine, préfixes) et de `check` / `apply`.
- e2e `gh340-*`.
