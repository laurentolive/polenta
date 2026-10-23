# GH82 — Design : renommer un statut ou une valeur d'enum

Spec : `specs/GH82.md`. Scénarios : `specs/GH82-tests.md`. **Un sprint**, sur `main` (pas de worktree).

## Vue d'ensemble

On réutilise la mécanique du renommage de champ (GH77 sprint 2) :
- transformation pure dans `@polenta/types` ;
- méthode de réécriture par service, en écriture brute ;
- orchestration dans `FieldRenameService`, qui reste une seule classe : renommages de champ et de
  valeur sur les objets d'un type ;
- bannière de compte rendu dans l'onglet Structure.

Nouveautés :
- un **aperçu** (comptes d'objets) avant l'enregistrement ;
- une **fenêtre de confirmation** ;
- la migration des **copies `testSnapshot`**.

```
StructureTab.handleSaveElement
  ├─ fieldRenames(updated)                      (GH77)
  ├─ valueRenames(updated, original)            ← nouveau (objectTypeEditor)
  ├─ si valueRenames : schema:preview-value-renames → ValueRenameConfirmModal
  │      Annuler → rien n'est enregistré
  │      Confirmer (lignes cochées) → default mis à jour pour les lignes cochées
  ├─ schema:save
  ├─ schema:rename-fields   (si renommages de champ)
  └─ schema:rename-values   (lignes cochées)    ← nouveau
         ├─ exigences / tests / campagnes du type : rewriteObjects(renameValues)
         └─ campagnes du repo : rewriteSnapshots(type, renameValues)
```

## 1. Types et logique pure (`packages/types/src/history.ts`)

```ts
/** GH82 — renommage d'une valeur : statut du type, ou valeur d'un champ enum / multi_enum. */
export type ValueRenameTarget = { kind: 'status' } | { kind: 'field'; field: string; multi: boolean }
export interface ValueRename { target: ValueRenameTarget; from: string; to: string }

/**
 * Applique d'un coup les renommages de valeur (échange a ↔ b correct) à `status` / `fields.<f>`
 * (multi_enum : élément de la liste CSV, ordre et séparateur ", " conservés ; un tableau YAML
 * reste un tableau) et aux `value` de `history.status` / `history.<f>`. `null` si rien ne change.
 */
export function renameValues<T extends HistoryCarrier>(obj: T, renames: ValueRename[]): T | null

/** Compte rendu : `FieldRenameResult` + nombre de copies de campagne migrées. */
export interface FieldRenameResult { migrated; skipped; failed; snapshots?: number }

export interface ValueRenamePreview { rename: ValueRename; withOld: number; withNew: number }
```

## 2. Main

### 2.1 Services — une réécriture générique

Le corps de `renameFieldKeys`, identique dans les trois services (verrou, lecture, transformation,
écriture brute, compte rendu), devient une méthode générique :

```ts
// RequirementsService, TestsService, CampaignsService
async rewriteObjects(repoPath, objectTypeRef, transform: (obj) => T | 'conflict' | null, result: FieldRenameResult): Promise<void>
```

`renameFieldKeys(…)` devient `rewriteObjects(…, o => renameFieldKeys(o, renames), result)`. On
supprime la duplication relevée à la revue de GH77 sprint 2. Écriture : `persist(…, { raw: true })`
inchangé, donc aucune entrée d'historique, ni revalidation, ni `version`.

`CampaignsService` ajoute :

```ts
/** GH82 — copies `testSnapshot` des entrées dont le test est de type `testTypeRef`, toutes campagnes du repo. */
async rewriteSnapshots(repoPath, testTypeRef, transform: (snapshot: TestCase) => TestCase | null, result): Promise<void>
```

Sous `enqueue` par campagne, écriture brute, `result.snapshots += n`. Ce sont les copies qui sont
réécrites, mais la campagne elle-même compte parmi les objets migrés, `result.migrated`, s'il y a
au moins une copie modifiée.

### 2.2 `FieldRenameService`

```ts
renameValues(repoPath, objectTypeRef, renames: ValueRename[]): Promise<FieldRenameResult>
  // objets du type (3 services) via rewriteObjects(renameValues) ;
  // + campaigns.rewriteSnapshots(objectTypeRef, renameValues) si le type est un type de test
previewValueRenames(repoPath, objectTypeRef, renames): Promise<ValueRenamePreview[]>
  // lecture seule : pour chaque renommage, nombre d'objets du type portant `from` / `to`
  // (statut, ou valeur du champ — élément de la liste pour multi_enum)
```

La catégorie du type est lue dans le schéma enregistré (`findObjectTypeDef`).

### 2.3 IPC

| Channel | Paramètres | Retour |
|---------|-----------|--------|
| `schema:preview-value-renames` | `repoPath, objectTypeRef, renames` | `ValueRenamePreview[]` |
| `schema:rename-values` | `repoPath, objectTypeRef, renames` | `FieldRenameResult` |

Validation des arguments, comme pour `schema:rename-fields` : `objectTypeRef` `<nœud>::<type>`,
renommages bien formés. Liste blanche web (`[0]`), `api-client`. Le garde-fou W12 (GH77) reste
inchangé : toutes les écritures passent par `persist`.

## 3. Renderer

### 3.1 `objectTypeEditor.tsx`

- `EditableStatus.originalName?: string` : posé par `statusToEditable`, non persisté. Une ligne
  ajoutée n'en a pas.
- `valueRenames(updated: EditableObjectType, original: ObjectTypeDefinition): ValueRename[]` :
  - **statuts** : lignes dont `originalName` diffère de `name` ;
  - **valeurs** : pour chaque champ qui a un `originalName`, dont le type d'origine **et** le type
    courant sont `enum` / `multi_enum`, et dont la liste a la **même longueur** que la liste
    d'origine, chaque position modifiée. La cible est le **nouveau** nom du champ, puisque le
    renommage de champ est migré d'abord.
- `withRenamedDefaults(updated, renames)` : `default` égal à `from` → `to`, pour les renommages
  retenus.

### 3.2 `ValueRenameConfirmModal.tsx` (nouveau, `components/schema/`)

- Une ligne par renommage, case cochée, libellé « Statut » ou « Champ <libellé> », puis
  « `from` → `to` ».
- « N objet(s) concerné(s) », et l'avertissement de collision si `withNew > 0`.
- Mention fixe « Les requêtes et dashboards du Suivi ne sont pas modifiés. »
- [Annuler] / [Enregistrer et migrer] ; `useModalHotkeys` (Échap / Entrée).
- Rendue par `StructureTab` au-dessus de `ElementConfigModal`. Annuler ferme seulement la
  confirmation : l'édition reste ouverte.

### 3.3 `StructureTab.handleSaveElement`

Il devient un flux en deux temps quand il y a des renommages de valeur : l'aperçu ouvre la
confirmation, puis la confirmation lance l'enregistrement et les migrations. Le compte rendu est
**fusionné** dans `FieldRenameBanner` : renommages de champ + renommages de valeur, objets migrés,
copies de campagne, non migrés, échecs. Invalidation de tout le cache, comme GH77.

### 3.4 i18n

Clés `schema.valueRename.*` (FR/EN) et ajout « copies de campagne » au compte rendu.

## 4. Documentation (fin de sprint)

- SPEC-REQ §4.4 « Évolution du schéma » : renommage de statut et de valeur d'enum (remplace « non
  migré (#82) »).
- SPEC-TESTS §4.2 : clés des copies migrées au renommage.
- SPEC-ELECTRON-DESKTOP §20.4 / §20.6 : canaux et confirmation.
- SPEC-TEMPLATES §3.2 / §3.3 : effet d'un renommage.
- SPEC-INDEX : MAJ GH82.

## Décisions techniques et alternatives rejetées

| Décision | Alternatives rejetées |
|----------|----------------------|
| Détection des valeurs par position, longueur égale | Diff textuel (ambigu), table de valeurs éditable (refonte UI hors périmètre) |
| Confirmation **avant** l'enregistrement du schéma | Après : une annulation laisserait le schéma renommé avec des objets orphelins |
| `rewriteObjects` générique dans chaque service | Une 2e copie du corps de `renameFieldKeys` (dette relevée en revue GH77) |
| Copies `testSnapshot` migrées dans toutes les campagnes du repo | Seulement les campagnes du type : les copies dépendent du type de *test*, pas de la campagne |
| Un seul compte rendu (champs + valeurs) | Deux bannières successives |

## Risques

- **Positions déplacées** (réordonner puis renommer dans la même édition) : un renommage peut être
  proposé à tort. C'est pour ça qu'il y a la confirmation, ligne par ligne et décochable.
- **Grosses campagnes** : la réécriture des copies parcourt toutes les campagnes du repo (une
  lecture par campagne). Acceptable pour une action rare.
