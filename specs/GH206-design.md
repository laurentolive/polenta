# GH206 — Design technique : contraintes de transition à niveaux

> Spec : `specs/GH206.md` (validée le 2026-11-05 ; Q1 : niveaux `off` / `warn` / `block`, `validatorsPass`).

## 1. Découpage

| Sprint | Périmètre |
|---|---|
| 1 | Types et évaluateur pur (`packages/types`), contrôle du schéma, renommage des statuts, `TransitionGuardService`, accroche dans les trois `persist`, canal `transitions:preview` (desktop et web), MCP, tests unitaires |
| 2 | Renderer : section « Transitions » de l'éditeur de schéma, menus de statut annotés, notification après un passage notifié, annulation de la saisie optimiste, `workspaceDir` transmis partout, i18n, e2e desktop et web, SPEC |

## 2. Types (`packages/types/src/transitions.ts`, exporté par `index.ts`)

```ts
export type TransitionLevel = 'off' | 'warn' | 'block'
export type TransitionCondition = 'fieldsFilled' | 'validatorsPass' | 'hasCoverageLink'
export interface TransitionRule {
  to: string
  from?: string
  requires: Partial<Record<TransitionCondition, TransitionLevel>>
}
/** Condition non remplie, avec son niveau effectif (`warn` ou `block`). */
export interface TransitionIssue {
  condition: TransitionCondition
  level: 'warn' | 'block'
  message: string          // une phrase, avec l'action à faire
  fields?: string[]        // fieldsFilled, validatorsPass : noms des champs
}
export interface TransitionCheck { blocked: boolean; issues: TransitionIssue[] }
```

- `ObjectTypeDefinition.transitions?: TransitionRule[]`.
- `TRANSITION_CATEGORIES = ['requirement', 'test', 'issue']`, `CONDITION_CATEGORIES` (`hasCoverageLink` : exigence).
- Réponse des écritures : `T & { transitionWarnings?: TransitionIssue[] }`. Le champ n'est **jamais écrit** ni mis
  dans l'index : il est ajouté à la copie renvoyée, après `persist`.

### Fonctions pures

| Fonction | Rôle |
|---|---|
| `matchingConditions(typeDef, fromStatus \| null, toStatus)` | règles applicables (`from` absent ou égal ; création = `null` : toutes les règles vers `to`), niveau le plus fort par condition, `off` exclus |
| `checkFieldsFilled(typeDef, obj)` | champs `required` vides + `requiredWhen` actifs (via `isFieldRequiredNow` et `objectFieldReader`, `status` = statut d'arrivée) |
| `checkValidators(typeDef, obj)` | champs remplis dont le `validator` échoue : `EARS` (`isEarsCompliant`), `regex:<motif>` |
| `transitionIssues(typeDef)` | cohérence du bloc (§3) : erreurs et avertissement D5 |
| `renameTransitionRefs(rules, valueRenames)` | `from` / `to` suivent les renommages de statut |

`isEarsCompliant` et `isFilled` passent de `field-checks.util.ts` (main) à `packages/types/src/field-validators.ts` ;
`field-checks.util.ts` les ré-exporte pour ne pas toucher ses appelants.

## 3. Schéma (`schema.service.ts`)

- À l'enregistrement (`save`, chemin des `requiredWhenIssues` l. 131) et à la mutation MCP : première erreur de
  `transitionIssues` → `SchemaValidationError('TRANSITION_INVALID', message)`. Erreurs :
  - bloc sur une catégorie hors `TRANSITION_CATEGORIES` ;
  - `to` / `from` inconnus, `from = to` ;
  - `requires` vide, condition inconnue ou non admise par la catégorie, niveau inconnu ;
  - deux règles de même `from` / `to`.
- Avertissement D5 (non bloquant) : condition `block` d'une règle qui peut s'appliquer en quittant un statut
  `isApproval` (`from` approuvé, ou `from` absent et `to` non approuvé).
- **Retrait d'un statut cité** : refus `TRANSITION_INVALID` nommant la règle. **Renommage** : l'éditeur appelle
  `renameTransitionRefs` dans la même passe que `withRenamedRequiredWhen` (`StructureTab.tsx:1159`) ;
  `transitions` rejoint `TYPE_EDITOR_KEYS` (`objectTypeEditor.tsx:71`).

## 4. Contrôle à l'écriture

### `TransitionGuardService` (nouveau, `transition-guard.service.ts`)

```ts
check(repoPath, typeDef, before: ObjectLike | null, after: ObjectLike & { id: string }, workspaceDir?): Promise<TransitionCheck>
```

- Sans changement de statut (`before && before.status === after.status`) ou sans règle : `{ blocked: false, issues: [] }`
  sans aucune lecture (D4, U1).
- `fieldsFilled`, `validatorsPass` : fonctions pures sur `after`.
- `hasCoverageLink` : `TraceabilityService.hasCoverage(repoPath, reqId, workspaceDir)` (nouveau) : index des tests
  et liens de tous les repos du workspace (`resolveRepoPaths`), `matchCoverageLink` sur l'exigence seule. Même
  règle que la matrice, tests terminaux compris (D7) ; aucun calcul de matrice complète.

### Accroche

- Les trois `persist` (`requirements`, `tests`, `issues`) reçoivent `workspaceDir` dans leurs options et appellent
  le garde **après** `applyFieldsWrite` (champs normalisés) et **avant** l'écriture, avec le `typeDef` du
  propriétaire (`readOwnedTypeDef`, pour qu'un type de sous-composant soit contrôlé). `opts.raw` (renommage,
  reprise git) : pas de contrôle.
- `blocked` → `TransitionBlockedError` : message `TRANSITION_BLOCKED: <motif> ; <motif>` (tous les motifs,
  bloquants puis notifiés), propriété `issues`. Le renderer reconnaît le code comme les autres erreurs métier.
- Sinon, les `issues` `warn` sont rendues dans `transitionWarnings` de l'objet renvoyé.

### Canal de pré-contrôle

- `transitions:preview(repoPath, category, objectId, workspaceDir) → Record<string, TransitionCheck>` : un résultat
  par statut du type (statut courant exclu). Lit l'objet, évalue chaque statut avec le même garde.
- `api.transitions.preview` (`packages/api-client`) ; ajouté à `WEB_EXPOSED` avec `ROOT_ARGS` `[0, 3]`.
- `requirements.transition`, `tests.update`, `issues.update` : le renderer passe `workspaceDir`, absent aujourd'hui
  (`SystemView.tsx:645`, `SearchEditPane.tsx:210`, `req.$reqId.tsx:101`).

## 5. MCP

- `bulk_import_*` `dryRun: true` : appel du garde (`before: null`) pour chaque entrée ; motifs bloquants dans les
  erreurs de l'entrée, notifiés dans `warnings`. `dryRun: false` : erreurs du service, `transitionWarnings` recopiés.
- `update_requirements` / `update_tests` : `planUpdate` reste pur ; `dryRun` appelle le garde sur l'état planifié
  (lien compris), ce qui évite l'écriture partielle relevée (`update.tools.ts:101-106`).
- `create_issue`, `update_issue` : par le service, même traitement.
- Mutation de schéma : `transitions` accepté sur `add_object_type` et dans l'outil de mise à jour d'un type, mêmes
  contrôles (§3).

## 6. Renderer (sprint 2)

- **Éditeur de schéma** : composant `TransitionRulesEditor` sous les statuts du type (exigence, test, issue
  seulement) : liste des règles, « Ajouter une règle » (statut d'arrivée, départ facultatif), une ligne par
  condition admise avec `SegmentedControl` Aucun contrôle / Notification / Blocage (Notification à l'ajout),
  retrait en un clic, avertissement D5 en ligne. Erreurs de `transitionIssues` affichées avant l'enregistrement.
- **Menus de statut** : hook `useTransitionPreview(repoPath, category, objectId)` (React Query, clé
  `['transitions', repoPath, objectId]`, chargé à l'ouverture du menu, invalidé avec l'objet et ses liens). Option
  bloquée : `disabled`, motif en `title` et en suffixe du libellé pour les `<select>` natifs (`ExcelView.tsx:466`,
  `WordView.tsx:575`, `EditView.tsx:119`, `DynamicField`) ; option notifiée : préfixe ⚠ et motif en `title`.
  Pages `req.$reqId`, `test.$testId`, issue : même hook.
- **Notification** : `transitionWarnings` d'une réponse → toast non bloquant (mécanisme de notification existant),
  liste des motifs, ID cliquables.
- **Refus** : `TRANSITION_BLOCKED` → message ; `autoSaveMutation.onError` (`SystemView.tsx:674`) annule l'édition
  en attente (`clearPendingEditsFor` avec la valeur réelle) au lieu du seul `console.error`.
- `test.$testId.tsx:107` envoie toujours `status` : sans effet grâce à D4, aucune modification nécessaire.

## 7. Décisions et alternatives rejetées

- **Niveau par condition, pas par règle** : une même transition peut bloquer sur les champs et seulement notifier
  la couverture, sans dupliquer la règle (doublons `from` / `to` interdits).
- **`warn` toujours écrit** : un fichier se lit sans connaître le défaut ; pas de valeur implicite.
- **Garde dans `persist`** plutôt que dans chaque méthode publique : un seul point par service, création, mise à jour,
  transition, import et MCP compris. Rejeté : contrôle dans les handlers IPC (le MCP le contournerait).
- **Avertissements dans la réponse** (`transitionWarnings`) plutôt qu'un second appel : pas de course entre contrôle
  et écriture. Rejeté : changer le type de retour en enveloppe `{ object, warnings }` (tous les appelants à revoir).
- **Pré-contrôle côté main** (`transitions:preview`) plutôt qu'un évaluateur dans le renderer : la couverture demande
  les liens de tout le workspace ; un seul calcul, identique à celui de l'écriture. L'évaluateur pur reste dans
  `packages/types` pour le main, les tests et l'éditeur de schéma.
- **Tests terminaux comptés** dans `hasCoverageLink` : même sens que la matrice (D7), signalé ici car le commentaire
  de préparation proposait de les exclure.
- **Aucun pré-contrôle dans les formulaires de création** : un objet neuf n'a pas de lien ; le refus ou la
  notification s'affichent à l'enregistrement.

## 8. Fichiers

| Zone | Fichiers |
|---|---|
| Types | `packages/types/src/transitions.ts` (nouveau), `field-validators.ts` (nouveau), `schema.ts`, `index.ts` |
| Main | `transition-guard.service.ts` (nouveau), `traceability.service.ts` (`hasCoverage`), `requirements.service.ts`, `tests.service.ts`, `issues.service.ts`, `field-checks.util.ts`, `schema.service.ts`, `container.ts`, `mcp-server/container.ts`, `ipc/index.ts` |
| Web | `web-server/channel-policy.ts` |
| MCP | `bulk-import.tools.ts`, `bulk-import-validation.util.ts`, `update.tools.ts`, `issues.tools.ts`, `schema-mutation.tools.ts` |
| Client | `packages/api-client` (`transitions.preview`, `workspaceDir` des transitions) |
| Renderer | `TransitionRulesEditor.tsx` (nouveau), `objectTypeEditor.tsx`, `StructureTab.tsx`, `useTransitionPreview.ts` (nouveau), `ExcelView.tsx`, `WordView.tsx`, `EditView.tsx`, `DynamicField.tsx`, `SystemView.tsx`, `SearchEditPane.tsx`, `req.$reqId.tsx`, `test.$testId.tsx`, page issue, `fr.json`, `en.json` |
| Specs | SPEC-REQ §4.3, SPEC-MCP-SERVER §4.2–§4.3, §4.6, §4.9, SPEC-TEMPLATES, SPEC-WEB §11 |
