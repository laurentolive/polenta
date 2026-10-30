# GH200 — Design : rattachement par élément

Spec : `specs/GH200.md`. Base : `milestone-D` @ 63846b7.

## 1. Vue d'ensemble

Une règle unique, appliquée **côté main** (services) pour l'interface et le MCP, et une **porte**
côté renderer qui ne sert qu'à obtenir le choix de l'utilisateur quand le main ne peut pas
décider seul.

```
renderer                            main
────────                            ────
ModificationGate ── check ────────► ChangeTrackingService.check(repo, el, kind)
  (choix / création si besoin)       │  on/off, éligibles, déjà assigné (P4)
  │                                  │
  └─ write(dto + changesetId) ─────► Requirements/TestsService.create|update|openDraft|transition
                                       ├─ verrou de l'approuvé (refus)
                                       └─ tracking.onModified(repo, el, kind, changesetId?)
                                            ├─ déjà dans un changeset non clos → base complétée si besoin
                                            ├─ changesetId → assign(base)
                                            ├─ un seul éligible → assign(base)
                                            └─ sinon → rien (backlog)
```

## 2. Main

### 2.1 `ChangeTrackingService` (nouveau, `main/services/change-tracking.service.ts`)

Dépend de `GitService`, `SchemaService.get`, `ChangesService` (lecture des résumés, `assign`,
écriture de `toModify`). Injecté dans `RequirementsService` / `TestsService` par un **hook**
optionnel (`tracking?: ModificationTracker`), comme `revalidation` : pas de dépendance circulaire.

```ts
type ModificationKind = 'create' | 'reopen' | 'terminal'

interface ModificationCheck {
  tracking: boolean                 // règle active pour ce repo (§1 spec)
  assignedTo: string | null         // déjà dans toModify d'un changeset non clos (P4)
  eligible: ChangeSummary[]         // changesets ouverts du repo
  component: string | null          // composant de l'élément (création d'un changeset)
}

class ChangeTrackingService implements ModificationTracker {
  isOn(repo): Promise<boolean>
  check(repo, el: { id?: string; objectTypeRef; category }, kind): Promise<ModificationCheck>
  onModified(repo, el: { id; category; filePath; versionBefore? }, kind, changesetId?): Promise<string | null>
  trace(repo, change: Change): Promise<ChangeToModifyTrace[]>        // §2.4
  outsideModifications(repo): Promise<OutsideModification[]>         // §2.5
}
```

- `isOn` : `schema.preferences.changeTracking` (`'on' | 'off'`) ; absente → `on` ssi le schéma
  déclare un type de catégorie `changeset`. Pas de type → toujours `off`.
- `onModified` : retourne l'ID du changeset d'assignation (ou `null`). Erreur d'assignation
  (changeset clos entre-temps…) → journalisée, l'écriture de l'élément n'est pas annulée (il
  tombe dans le backlog, filet).

### 2.2 Types (`packages/types/src/change.ts`)

```ts
export interface ChangeElementRef { sha: string | null; version: number }
export interface ChangeToModify {
  id: string
  state: 'planned' | 'modified'
  base?: ChangeElementRef          // GH200 — absent : création (ou planifié sans réouverture)
  approved?: ChangeElementRef      // GH200 — écrit au gel uniquement
}
/** Trace calculée d'une ligne (page, graphe, MCP). */
export interface ChangeToModifyTrace {
  id: string
  state: 'planned' | 'modified'
  base: ChangeElementRef | null
  created: boolean                 // élément créé dans ce changeset (pas de base, premier commit après l'assignation)
  approved: ChangeElementRef | null
  approvalPending: boolean         // non approuvé (ou approbation pas encore publiée)
}
export interface OutsideModification { id; category; title; approvedSha: string | null; dirty: boolean }
```

`ProjectPreferences.changeTracking?: 'on' | 'off'`. `CreateRequirementDto`, `UpdateRequirementDto`,
`TransitionRequirementDto`, `CreateTestCaseDto`, `UpdateTestCaseDto` + `openDraft(…, changesetId?)` :
champ facultatif `changesetId`. `cleanToModify` conserve `base` / `approved`.

### 2.3 Verrou de l'approuvé

`RequirementsService.update` / `TestsService.update` : si le statut **avant** et **après** l'écriture
est `isApproval` et que le DTO modifie un champ de contenu (`title`, `fields`, `objectTypeRef`,
`steps`, `preconditions`, `postconditions`, `equipment`) → `ApprovedLockedError`
(`« SYS-0002 est approuvée : rouvrez-la pour la modifier »`). Un DTO qui fait quitter l'approbation
**et** modifie le contenu (MCP `update_*` avec `status: draft`) est accepté : c'est une
réouverture. Écritures `raw` (renommages, reprise d'historique, `retargetObjectTypeRef`),
`needsRevalidation`, liens : non concernées (autres chemins).

### 2.4 Trace : `base`, `approved`, `state`

- **`base` à la réouverture** : `GitService.lastCommitTouching(repo, path)` (nouveau : chaîne des
  premiers parents de `HEAD`, comparaison de l'oid du blob — même approche que `commitChanges`)
  → `{ sha, version: versionBefore }`. Fichier jamais commité : `sha: null`.
- **Élément planifié à la main** (`planned` sans `base`) puis rouvert dans ce changeset :
  `onModified` complète `base`.
- **`approved` calculé** (`trace`) : commits de la chaîne des premiers parents qui touchent le
  fichier, postérieurs à `base.sha` (ou tous pour une création) ; on lit le fichier du plus récent
  vers le plus ancien (`readTextAt`) et on retient le **commit où il est entré** dans un statut
  `isApproval` pour la dernière fois (pas un commit postérieur qui ne fait que lever
  `needsRevalidation`). Statut courant sur disque non `isApproval`, ou approbation non publiée →
  `approvalPending`.
- **`state`** affiché : `modified` si stocké, ou s'il existe un commit postérieur à `base` (création :
  tout commit) touchant le fichier, ou si le fichier diffère de `HEAD`.
- **Gel** : `ChangesService.update`, au passage dans un statut terminal (même endroit que
  l'analyse figée), écrit `approved` et `state` calculés dans `toModify` ; à la sortie, `approved`
  retiré (comme `analysis`).
- **Cache** : `trace` mémorisé par `(repo, HEAD sha, changeId)` ; le statut sur disque est relu à
  chaque appel (pas de cache).

### 2.5 Hors interface

`outsideModifications(repo)` : pour chaque exigence / test au statut `isApproval` **sur disque** :
commit d'entrée en approbation (même lecture qu'en §2.4), contenu normalisé (champs de contenu du
§2.3, sans `history`, `needsRevalidation`, `version`) comparé au contenu sur disque. Différent →
hors interface (`dirty` si la différence n'est pas encore commitée). Mémorisé par `HEAD` sha + mtime
des fichiers. Appelé par `ChangesService.backlog` (règle `on`) : les éléments s'ajoutent au backlog
de leur composant avec `outside: true`.

**Limite connue** : les renommages de champs / valeurs du schéma (GH77, GH82) réécrivent les
éléments approuvés : signalés « modifié hors interface » jusqu'à leur prochaine réouverture. Accepté
(signalement seulement) ; noté dans SPEC-REQ.

### 2.6 Câblage

- `RequirementsService.create` → `onModified(…, 'create', dto.changesetId)` ;
  `openDraft` / `transition` / `update` (statut qui quitte `isApproval`) → `'reopen'` ou
  `'terminal'` (statut cible `isTerminal`) avec `versionBefore = existing.version`. Idem
  `TestsService`. Appel **hors** du verrou de l'élément (comme `markImpactedBy`).
- `ChangesService` : `backlog` (+ `outside`), `get` / `list` inchangés ; nouvelle méthode
  `trace(repo, id)` déléguée au tracker ; `update` gel ; `cleanToModify` garde `base` / `approved`.
- IPC : `changesets:modification-check`, `changesets:trace` ; `changesetId` dans les DTO existants.
  api-client + preload + web-server (mêmes routes que les autres `changesets:*`).
- MCP (`container.ts`) : tracker injecté ; `bulk_import_requirements` / `bulk_import_tests` /
  `update_requirements` / `update_tests` : paramètre `changesetId`, réponse `unassigned` (éléments
  créés / rouverts sans assignation alors que la règle est active) ; `get_changeset` : `trace`.
- Graphe : `GraphChange.toModify[]` = trace (`base`, `approved`, `created`) via le tracker ;
  `polenta.d.ts` régénéré.

## 3. Renderer

### 3.1 `ModificationGateContext` (généralise `ApprovalGateContext`)

```ts
type Gate = (repoPath, el: { id?: string; objectTypeRef; category }, kind: ModificationKind | 'approve', toStatus?)
  => Promise<{ ok: boolean; changesetId?: string }>
```

- `approve` : comportement actuel (§8bis, filet).
- `create` / `reopen` / `terminal` : `modificationCheck` ; si `!tracking` ou `assignedTo` ou
  `eligible.length === 1` → `{ ok: true }` (le main assigne ; toast « Ajouté à NC-0004 » affiché
  par l'appelant à partir de la réponse) ; sinon dialogue :
  - plusieurs → **« Dans quel changeset ? »** (réutilise `AssignToChangeDialog`, mode `modify` :
    liste + « Nouveau changeset… », dernier choix mémorisé en session) ;
  - aucun → formulaire de création (`AssignToChangeDialog` étape création, déjà présente pour
    « Nouveau change ») ; le changeset est créé **avant** l'écriture de l'élément ;
  - Annuler → `{ ok: false }`.
- `useApprovalGate` conservé comme alias (appelants existants inchangés), plus `useModificationGate`.
- Un appel par lot (`kind: 'create'`, liste d'éléments) pour la création en masse.

### 3.2 Points d'appel

| Endroit | Action | Gate |
|---|---|---|
| `routes/req.new.tsx`, `routes/test.new.tsx` | création | `create` → `changesetId` dans le DTO |
| `SystemView` (création inline 748, création 851), `SystemViewContext` (763, 779) | création | idem |
| `SystemView.reopenDraftMutation` (Word) | réouverture | `reopen` |
| `SystemView` statut (615), `SearchEditPane` (208), `req.$reqId` (102), `test.$testId` (104) | statut qui quitte l'approbation | `reopen` / `terminal` ; vers `isApproval` : `approve` (inchangé) |
| Backlog « Rouvrir et assigner… » | réouverture | `reopen` |

Le toast d'assignation automatique est affiché à partir du retour de l'écriture : le DTO de
réponse gagne `assignedTo?: string` (renvoyé par `onModified`).

### 3.3 Verrou dans les vues

- `ExcelView` : cellule éditable seulement si le statut de la ligne n'est pas `isApproval`
  (la colonne Statut reste éditable : c'est la réouverture) ; infobulle « Approuvé — rouvrez pour
  modifier ».
- `EditView` (éditeur de l'onglet Édition, `SearchEditPane`) : `readOnly` quand le statut courant
  est `isApproval`, bandeau avec « Rouvrir en brouillon ».
- `req.$reqId` / `test.$testId` : champs en lecture seule si approuvé (le bouton de transition
  existant propose déjà le statut suivant).
- Vue Word : inchangée (déjà verrouillée).
- Une écriture refusée par le main (`ApprovedLockedError`, course entre deux onglets) s'affiche
  comme une erreur d'enregistrement normale.

### 3.4 Page d'un changeset et backlog

- `ChangeToModifyList` : colonnes Départ / Approbation / état, action « Voir les modifications »
  → route `/diff` étendue : paramètres `baseSha` (facultatif) et `commitSha` (facultatif) ;
  `baseSha` + `commitSha` → `sync.diffFileBetween` ; `baseSha` seul → nouveau
  `sync.diffFileAgainstWorkdir(repo, sha, path)` ; création → `baseSha` absent, fichier entier
  face à vide (`diffFileBetween` sur l'arbre vide). Données via `changesets:trace`.
- Backlog : badge « modifié hors interface », « Voir les modifications » (approbation → disque),
  « Rouvrir et assigner… ».
- Préférences (`routes/preferences.tsx`) : case « Toute modification passe par un changeset »
  (`changeTracking`), écrite seulement si différente du défaut.

## 4. Sprints

| Sprint | Périmètre |
|---|---|
| **1 — main** | types, `ChangeTrackingService` (isOn, check, onModified, base), verrou des services, câblage create / reopen / terminal, IPC / api-client / web-server, MCP (`changesetId`, `unassigned`, verrou), tests unitaires |
| **2 — renderer** | `ModificationGate`, points d'appel, toast, verrou Excel / EditView / pages, préférence, e2e A1, A3–A7, A10, A11, A14 |
| **3 — trace et filet** | `trace` (`approved`, `state`, cache), gel au terminal, colonnes + diff, hors interface + backlog, graphe + `polenta.d.ts`, MCP `get_changeset`, e2e A8, A9, A13, SPEC |

## 5. Alternatives rejetées

- **Porte uniquement côté renderer** : le MCP et les autres clients ne seraient pas couverts ;
  la règle « un seul éligible → automatique » vit donc dans le main.
- **`approved` écrit à chaque approbation** : le SHA n'existe qu'à la publication ; l'écrire
  exigerait une écriture du changeset après le commit. Calculé, puis figé au terminal (même
  principe que l'analyse, GH199 §2).
- **Détection hors interface par message de commit** : abandonnée avec la ligne `Change:`.
