# GH68 — Design : tests non approuvés dans les campagnes

Spec : `specs/GH68.md`. Issue : #68.

## 1. Vue d'ensemble

Trois changements indépendants :

1. **Éligibilité** (renderer) : le filtre « approuvé » disparaît du sélecteur (onglet Tests et
   report GH64) ; le statut reste visible.
2. **Resynchronisation** (main) : une nouvelle méthode `CampaignsService.refreshEntries()` remplace
   la copie `testSnapshot` des instances *resynchronisables* par l'état actuel du test. Elle est
   appelée à l'ouverture de la page d'exécution et à l'export du classeur Excel.
3. **Signalement** (renderer + main) : badge et bandeau dans la page campagne, bandeau et
   confirmation à l'exécution, avertissement dans l'aperçu d'import Excel.

```
                      ┌─ ouverture page d'exécution ─→ campaigns:refresh-entries(entryId) ─┐
CampaignsService ─────┤                                                                    ├→ testSnapshot := test live
  .refreshEntries()   └─ CampaignExecutionService.exportSheet (instances pending) ─────────┘   (si pending ∧ copie non approuvée)
```

## 2. Décision clé : où la copie est figée (précision de la spec §10)

La spec prévoyait aussi une resynchronisation **à la saisie du résultat** (`updateRun`) et **à
l'import Excel**. Le design ne la retient pas : elle figerait une version que le testeur **n'a pas
vue**. La page d'exécution construit l'état de saisie par `order` d'étape à partir de la copie
affichée, et l'import Excel valide les étapes contre `testSnapshot` (`steps_mismatch`,
`campaign-execution-import.ts`). Si le test change entre l'affichage et la saisie, recopier l'état
live à la saisie associerait des résultats d'étapes à un texte différent, ou ferait rejeter un
classeur pourtant correct.

Règle retenue : **la copie est rafraîchie au moment où le testeur reçoit le contenu**, puis
c'est cette version qui est figée par le résultat.

| Moment | Effet | Spec |
|--------|-------|------|
| Ouverture de la page d'exécution | `refreshEntries([entryId])`, écrit si la copie change ; la page affiche la copie rafraîchie | §10 (1) |
| Saisie du résultat (`updateRun`) | **inchangé** : fige la copie déjà affichée | §10 (2) précisé |
| Export du classeur Excel | `refreshEntries(toutes les pending)` **avant** de construire le classeur, avec écriture | §10 (4) précisé : la campagne est réécrite |
| Import du classeur | **inchangé** : fige la copie exportée, validée contre elle | §10 (3) précisé |

Impact sur la spec à reporter lors du sprint 2 (mise à jour de `specs/GH68.md` et SPEC-TESTS) :
CA7 « copie = version au moment de la saisie » devient « version affichée à l'ouverture de la page
d'exécution » ; CA9 « copie figée = état au moment de l'import » devient « état au moment de
l'export ».

Alternative rejetée : resynchroniser à `updateRun` en comparant une version attendue envoyée par
le renderer (refus si elle diffère). C'est plus robuste aux modifications concurrentes, mais ça
ajoute un chemin d'erreur pour un cas rare (test modifié pendant qu'on l'exécute), que la règle
« figé = affiché » couvre déjà.

## 3. Types — `packages/types`

### 3.1 Helper partagé (`src/schema.ts`)

```ts
/** GH68 — statut d'approbation d'un type (`statuses[].isApproval`), repli sur `approved`
 *  (type introuvable ou sans statut d'approbation). Même règle que maturity.util / isTestApproved. */
export function isApprovalStatus(typeDef: ObjectTypeDefinition | null | undefined, status: string): boolean {
  const approvalStatusName = typeDef?.statuses?.find(s => s.isApproval)?.name
  return status === (approvalStatusName ?? 'approved')
}
```

Remplace le corps de `isTestApproved` (renderer). `maturity.util.ts` n'est pas modifié (hors
périmètre ; c'est la même règle).

### 3.2 Aperçu d'import (`src/campaign-execution-sheet.ts`)

```ts
export interface ExecutionImportPreview {
  // …
  warnings: Array<
    | { code: 'row_without_key'; row: number }
    | { code: 'test_not_approved'; entryId: string; status: string }   // GH68
  >
}
```

### 3.3 API client (`packages/api-client`)

```ts
campaigns: {
  /** GH68 — rafraîchit la copie des instances resynchronisables parmi `entryIds`. */
  refreshEntries(repoPath: string, campaignId: string, entryIds: string[]): Promise<TestCampaign>
}
```

Canal IPC `campaigns:refresh-entries` → `ipc/index.ts`, `ipc-client.ts`, `types.ts`,
`web-server/channel-policy.ts` (écriture, même rôle que `campaigns:update-run`, index de repo `[0]`).

## 4. Main

### 4.1 `CampaignsService.refreshEntries(repoPath, campaignId, entryIds)`

```ts
async refreshEntries(repoPath: string, campaignId: string, entryIds: string[]): Promise<TestCampaign> {
  return this.enqueue(repoPath, campaignId, async () => {
    const campaign = await this.get(repoPath, campaignId)
    if (campaign.status === 'completed' || campaign.status === 'abandoned') return campaign   // §15
    const wanted = new Set(entryIds)
    const candidates = campaign.runs.filter(r => wanted.has(r.entryId) && r.status === 'pending' && r.testSnapshot)
    if (candidates.length === 0) return campaign
    const isApproved = await this.approvalPredicate(repoPath)
    const resync = candidates.filter(r => !isApproved(r.testSnapshot!))
    const live = await this.snapshotsFor(repoPath, resync.map(r => r.testCaseId))   // supprimé → absent (§14)
    let changed = false
    for (const run of resync) {
      const next = live.get(run.testCaseId)
      if (next && !isDeepStrictEqual(next, run.testSnapshot)) { run.testSnapshot = next; changed = true }
    }
    if (changed) await this.gitService.writeYaml(repoPath, `campaigns/${campaignId}.yaml`, campaign)
    return campaign
  })
}

/** Lit le schéma une fois et renvoie le prédicat « copie approuvée » (`isApprovalStatus`). */
private async approvalPredicate(repoPath: string): Promise<(tc: TestCase) => boolean>
```

- Schéma lu via `gitService.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')` +
  `findObjectTypeDef` (`schema-lookup.util.ts`), comme `RequirementsService.readTypeDef`. Pas de
  nouvelle dépendance au constructeur (le container MCP n'est pas touché).
- **Entrée sans copie** (pré-T49) : ignorée ; elle est déjà résolue en live.
- **Paramètres** : ni recalculés ni modifiés (spec §13).
- L'écriture ne se fait que si la copie change. Ouvrir la page d'exécution d'un test approuvé ou
  inchangé n'écrit rien.
- Une copie resynchronisée sur une version approuvée cesse d'être resynchronisable (spec §12) :
  conséquence directe du filtre `!isApproved(snapshot)`.

### 4.2 `CampaignExecutionService`

- `exportSheet` : avant de construire le modèle, appelle
  `campaigns.refreshEntries(repoPath, campaignId, <entryIds des runs pending>)` et travaille sur
  la campagne renvoyée. Le refus « campagne clôturée » reste en tête.
- `preview` : passe à `validateExecutionImport` un prédicat `isApproved` (même
  `approvalPredicate`, exposé par `CampaignsService` en méthode publique `approvalPredicate`) ;
  `validateExecutionImport` ajoute un warning `test_not_approved` pour chaque instance
  **importable** dont la copie (`testSnapshot`) n'est pas approuvée. Entrée sans copie : pas
  d'avertissement (le statut live n'est pas lu à l'import ; cas pré-T49 marginal).
- `apply` : inchangé (n'est pas refusé — spec §19).

### 4.3 `TraceabilityService.generateTestPlan`

Inchangé : `testCaseFilter` n'y est pas exploité aujourd'hui.

## 5. Renderer

### 5.1 Éligibilité

| Fichier | Changement |
|---------|------------|
| `routes/campaign.$campaignId.tsx` | `availableTests` : suppression de `.filter(t => isTestApproved(t, schema))`. `isCarryEligible` à l'ajout → `() => 'ok'`. `isTestApproved` conservé pour les badges (§5.2), réécrit sur `isApprovalStatus`. |
| `lib/carryOver.ts` | `'notApproved'` retiré de `CarryEligibility` et `CarryUnavailable`. |
| `components/campaign/TestPickerModal.tsx` | Message vide unique `noTestCaseAvailable` (suppression de la branche `mode === 'add'`). |
| `components/campaign/TestPickerGrid.tsx` | Colonne `status` **forcée** dans `visibleFields` si absente des préférences (insérée après `id`, sans réécrire les préférences). |
| `components/campaign/CampaignCarryPanel.tsx` | Badge « Non approuvé » sur une ligne dont le test live n'est pas approuvé (même composant que §5.2). |
| `i18n/locales/{fr,en}.json` | Suppression de `noApprovedTestAvailable` et de `…unavailable.notApproved` ; ajout des clés §5.5. |

Choix pour la grille : forcer la colonne Statut plutôt qu'ajouter un badge dans la cellule ID
d'`ExcelView`. La colonne est déjà rendue avec le libellé du statut du type, elle se filtre (T51),
et `ExcelView` (partagée avec la vue système) n'est pas touché.

### 5.2 Page campagne (`campaign.$campaignId.tsx`)

```ts
/** GH68 — statut à juger : live tant que l'instance est resynchronisable, sinon la copie. */
function entryTestForApproval(run: CampaignTestRun, live: TestCase | undefined, schema): TestCase | undefined
```
- `pending` avec une copie non approuvée → test live s'il existe (§7), sinon la copie.
- Sinon → `run.testSnapshot ?? live`.

Composant `NotApprovedBadge` (`components/campaign/NotApprovedBadge.tsx`) : pastille warning
« Non approuvé », infobulle avec le libellé du statut (`statuses[].label` du type, sinon le nom).
Affiché à côté de la mention `↩ CAMP-…` dans la ligne d'instance. Réutilisé par le panneau de
report (§5.1) et par la page d'exécution (§5.3).

Bandeau `NotApprovedRunsBanner` sous `UnresolvedParamsBanner` : compte les instances `pending`
dont le test (selon `entryTestForApproval`) n'est pas approuvé ; rien si 0.

### 5.3 Page d'exécution (`campaign.$campaignId_.execute.$testId.tsx`)

1. Au montage, quand `entry` est chargée, `pending`, avec `testSnapshot` et campagne ouverte :
   `useMutation(refreshEntries([entryId]))` lancé **une fois** (ref), `onSuccess` →
   `qc.setQueryData(['campaign', repoPath, campaignId], campaign)`. Tant que la mutation tourne,
   la page reste en chargement : on n'affiche pas une copie qui va changer, et l'état des étapes
   n'est pas initialisé deux fois. En cas d'erreur, on affiche la copie existante et un message
   discret ; l'exécution reste possible.
2. Bandeau warning en tête si la copie affichée n'est pas approuvée (spec §16).
3. `submitExecution` : si `entry.status === 'pending'` et la copie n'est pas approuvée →
   modale de confirmation (spec §17) avant `executeMutation.mutate()`. Une instance déjà
   exécutée qu'on ré-exécute ne redemande pas la confirmation. Modale : même structure que
   `ConfirmCloseTabModal` (Annuler / Exécuter quand même), Ctrl+Entrée inclus (le raccourci
   passe par `submitExecution`).

### 5.4 Import Excel (`components/campaign/ExecutionImportModal.tsx`)

Rendu du warning `test_not_approved` dans la liste d'avertissements de l'aperçu : « {{entryId}} :
test non approuvé ({{status}}) ».

### 5.5 Analyse d'impact (`routes/impact-analysis.tsx`)

`testCaseFilter: 'approved_only'` → `'include_draft'` (spec §21).

### 5.6 Clés i18n (fr / en)

- `campaignPage.notApproved` : « Non approuvé » / « Not approved »
- `campaignPage.notApprovedTooltip` : « Statut du test : {{status}} » / « Test status: {{status}} »
- `campaignPage.notApprovedBanner` (pluriel `_one`/`_other`) : « {{count}} instance(s) à exécuter
  porte(nt) sur des tests non approuvés »
- `campaignPage.executeNotApprovedBanner` : « Ce test n'est pas approuvé (statut : {{status}}). Le
  résultat sera enregistré contre cette version non validée. »
- `campaignPage.executeNotApprovedConfirmTitle` / `…Body` / `…Confirm` (« Exécuter quand même »)
- `executionImport.warning.test_not_approved` : « {{entryId}} : test non approuvé ({{status}}) »
- `campaignPage.refreshFailed` : « Impossible de mettre à jour la copie du test : la version
  figée à l'ajout est affichée. »

## 6. Documentation

- `SPEC-TESTS.md §4.2` : paragraphe « Snapshot à l'inclusion (T49) » complété (exception GH68 :
  instance pending non approuvée resynchronisée à l'ouverture de l'exécution et à l'export Excel)
  ; « Le gating "test approuvé"… » remplacé par la nouvelle règle ; sélecteur et report
  (motif « non approuvé » retiré). `§4.5` : warning `test_not_approved`.
- `SPEC-INDEX.md` : mots-clés `non approuvé, resynchronisation, refreshEntries` sur la ligne §4.1–4.2.
- `specs/GH68.md` : CA7 / CA9 / §10 alignés sur §2 de ce design.

## 7. Découpage — 2 sprints

**Sprint 1 — main et plumbing** (testable sans UI)
- `isApprovalStatus` (types) + test unitaire
- `CampaignsService.refreshEntries` / `approvalPredicate` + tests
  (`campaigns.service.refresh.test.ts`)
- `CampaignExecutionService` : refresh à l'export, warning à l'aperçu ; type de warning ;
  `validateExecutionImport` + tests
- Canal `campaigns:refresh-entries` (IPC, api-client, channel-policy)

**Sprint 2 — renderer**
- Éligibilité (§5.1), badges/bandeau (§5.2), page d'exécution (§5.3), import (§5.4), analyse
  d'impact (§5.5), i18n
- Mise à jour de `carryOver.test.ts` et de l'e2e `gh64-carry-over.spec.ts` ; nouvel e2e
  `gh68-unapproved.spec.ts`
- Documentation (§6)
