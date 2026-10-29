import type { TestCampaign, CampaignStatus, CampaignTestRun, RemovedCampaignTestRun, TestRunResult, CreateCampaignDto, UpdateCampaignDto, TestCase, ParamResolutionPreview, ReqInstanceSelection, CarriedEntrySelection, ProjectSchema } from '@polenta/types'
import type { GitService } from './git.service'
import type { TestsService } from './tests.service'
import type { ParametersService } from './parameters.service'
import type { SchemaService } from './schema.service'
import type { HistoryService } from './history.service'
import { REQ_REF_PREFIX, carryKey, extractTestReqRefs, isApprovalStatus, renameFieldKeys, withoutHistory } from '@polenta/types'
import type { FieldRename, FieldRenameResult, HistoryCarrier, ObjectHistory } from '@polenta/types'
import { assertNewObjectFile, deleteWithTombstone, nextCounterId } from './id-counter.util'
import { findObjectTypeDef } from './schema-lookup.util'
import { applyFieldsWrite } from './field-write.util'

export class CampaignsService {
  constructor(
    private readonly gitService: GitService,
    private readonly testsService: TestsService,
    /** T171 — résolution des paramètres de la base à l'ajout ; absent (MCP) : comportement T97. */
    private readonly parameters?: ParametersService,
    /** GH80 — schéma en cache pour la règle d'approbation ; absent (tests) : relu du disque. */
    private readonly schema?: Pick<SchemaService, 'get'>,
    /** GH77 — historique des champs suivis ; absent (tests unitaires) : pas d'historique. */
    private readonly history?: HistoryService,
  ) {}

  private writeQueues = new Map<string, Promise<unknown>>()

  /**
   * Sérialise les mutations read-modify-write ciblant la même campagne — sans ça, deux
   * mutations concurrentes (ex. plusieurs `duplicateTest()` déclenchés en parallèle par un
   * ajout groupé, ou "ajouter" et "retirer" à la milliseconde près) lisent le même état de
   * départ via `get()` et la dernière écriture écrase silencieusement les autres (T103 :
   * tests ajoutés qui disparaissent, ajout/retrait qui semble ne plus rien faire).
   */
  private enqueue<T>(repoPath: string, campaignId: string, task: () => Promise<T>): Promise<T> {
    const key = `${repoPath}::${campaignId}`
    const prev = this.writeQueues.get(key) ?? Promise.resolve()
    const run = prev.then(task, task)
    this.writeQueues.set(key, run.then(() => undefined, () => undefined))
    return run
  }

  async list(repoPath: string, component?: string, level?: string): Promise<TestCampaign[]> {
    const files = await this.gitService.listFiles(repoPath, 'campaigns')
    const campaigns: TestCampaign[] = []

    for (const file of files) {
      if (!file.endsWith('.yaml')) continue
      const campaign = await this.gitService.readYaml<TestCampaign>(repoPath, file)
      if (!campaign) continue

      // Filter by component if specified. GH146 — même repli que pour `level` : à défaut de
      // `component`, le nœud se lit dans `objectTypeRef` ; une campagne sans l'un ni l'autre reste visible.
      const campaignComponent = campaign.component
        ?? (campaign.objectTypeRef?.includes('::') ? campaign.objectTypeRef.split('::')[0] : undefined)
      if (component && campaignComponent && campaignComponent !== component) continue
      // Filter by level if specified. GH59 — `level` est optionnel dans les fichiers (campagnes
      // écrites hors de l'app) : à défaut, le type de campagne se lit dans `objectTypeRef`, et une
      // campagne sans l'un ni l'autre reste visible.
      const campaignLevel = campaign.level ?? campaign.objectTypeRef?.split('::')[1]
      if (level && campaignLevel && campaignLevel !== level) continue

      campaigns.push(this.ensureEntryIds(campaign))
    }

    return campaigns.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async get(repoPath: string, id: string): Promise<TestCampaign> {
    const campaign = await this.gitService.readYaml<TestCampaign>(repoPath, `campaigns/${id}.yaml`)
    if (!campaign) throw new Error(`Campaign not found: ${id}`)
    return this.ensureEntryIds(campaign)
  }

  async create(repoPath: string, dto: CreateCampaignDto, workspaceDir?: string): Promise<TestCampaign> {
    const id = await this.nextCampaignId(repoPath)
    const testCaseIds = dto.testCaseIds ?? []
    const snapshots = await this.snapshotsFor(repoPath, testCaseIds)
    const previews = await this.previewsFor(repoPath, snapshots, dto.baselineRef, workspaceDir)
    // GH73 — les entrées initiales sont ajoutées à la création : `addedAt` = `createdAt`.
    const now = new Date().toISOString()
    const alloc = entryAllocator([], undefined, now)

    const campaign: TestCampaign = {
      id,
      title: dto.title,
      objectTypeRef: dto.objectTypeRef,
      fields: dto.fields ?? {},
      level: dto.level,
      component: dto.component,
      baselineRef: dto.baselineRef,
      status: 'planned',
      testCaseIds: [],
      runs: this.buildNewRuns([], alloc, testCaseIds, dto.paramValuesByTest, snapshots, previews, dto.reqInstances),
      createdAt: now,
      completedAt: null,
    }
    // GH64 — entrées reportées depuis d'autres campagnes, après celles de l'onglet Tests.
    campaign.runs.push(...await this.buildCarriedRuns(repoPath, undefined, campaign.runs, alloc, dto.carried, dto.baselineRef, workspaceDir))

    // T179 — une occurrence par instance créée (un test itérant en a une par exigence retenue).
    campaign.testCaseIds = campaign.runs.map(r => r.testCaseId)
    await assertNewObjectFile(this.gitService, repoPath, `campaigns/${id}.yaml`, id)
    return this.persist(repoPath, id, null, campaign)
  }

  async update(repoPath: string, id: string, dto: UpdateCampaignDto): Promise<TestCampaign> {
    return this.enqueue(repoPath, id, async () => {
      const existing = await this.get(repoPath, id)

      const updated: TestCampaign = {
        ...existing,
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.objectTypeRef !== undefined && { objectTypeRef: dto.objectTypeRef }),
        fields: { ...(existing.fields as object), ...(dto.fields ?? {}) },
      }

      return this.persist(repoPath, id, existing, updated)
    })
  }

  async updateRun(
    repoPath: string,
    campaignId: string,
    entryId: string,
    status: TestRunResult,
    /** GH73 — run qui porte ce résultat : obligatoire, chaque verdict d'entrée est un fichier daté. */
    runId: string,
    /**
     * GH36 — import d'un classeur d'exécution : date et testeur lus dans le fichier.
     * GH81 — `testSnapshot` : version du test affichée/exportée, figée sur une instance
     * resynchronisable (ignorée sinon), dans la même écriture que le résultat.
     */
    meta?: { executedAt?: string; executedBy?: string; testSnapshot?: TestCase },
  ): Promise<TestCampaign> {
    // GH73 — garde à l'exécution (canal IPC non typé) : pas de statut sans run, pas de retour à
    // `pending` — la chronologie d'une entrée se reconstruit depuis ses runs rattachés.
    if (typeof runId !== 'string' || !runId) throw new Error(`A test run is required to record a result on ${entryId}`)
    if (!(RUN_RESULTS as readonly string[]).includes(status)) throw new Error(`Invalid result ${status} for ${entryId}`)

    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)
      const original = historyBase(campaign)

      const runIndex = campaign.runs.findIndex(r => r.entryId === entryId)
      if (runIndex === -1) throw new Error(`Entry ${entryId} not found in campaign ${campaignId}`)

      const displayed = meta?.testSnapshot
      let frozen: TestCase | undefined
      if (displayed) {
        if (displayed.id !== campaign.runs[runIndex].testCaseId) {
          throw new Error(`Test ${displayed.id} does not match entry ${entryId} (${campaign.runs[runIndex].testCaseId})`)
        }
        const isApproved = await this.approvalPredicate(repoPath)
        if (isResyncable(campaign, campaign.runs[runIndex], isApproved)) frozen = withoutHistory(displayed) as TestCase
      }

      // `executedBy` est réécrit à chaque saisie : absent (exécution dans l'outil), il est retiré
      // pour ne pas laisser le testeur d'un import précédent sur un nouveau résultat (GH36).
      const { executedBy: _previousTester, ...previous } = campaign.runs[runIndex]
      campaign.runs[runIndex] = {
        ...previous,
        ...(frozen && { testSnapshot: frozen }),
        status,
        runId,
        executedAt: meta?.executedAt ?? new Date().toISOString(),
        ...(meta?.executedBy && { executedBy: meta.executedBy }),
      }

      // Auto-set status to in_progress if currently planned
      if (campaign.status === 'planned') {
        campaign.status = 'in_progress'
      }

      return this.persist(repoPath, campaignId, original, campaign)
    })
  }

  async close(
    repoPath: string,
    id: string,
    status: 'completed' | 'abandoned',
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, id, async () => {
      const campaign = await this.get(repoPath, id)
      const original = historyBase(campaign)

      campaign.status = status as CampaignStatus
      campaign.completedAt = new Date().toISOString()

      return this.persist(repoPath, id, original, campaign)
    })
  }

  /**
   * GH81 — version effective de chaque entrée, en lecture seule (ne remplace jamais la copie) :
   * test live (sans `history`) pour une instance resynchronisable (`isResyncable`, règle GH68),
   * copie figée sinon, test live pour une entrée pré-T49 (sans copie). Test resynchronisable
   * supprimé : copie existante. Entrée absente de la map : test introuvable. Les paramètres de
   * l'instance ne sont pas recalculés. La copie n'est figée qu'à la saisie du résultat (`updateRun`).
   */
  async effectiveTests(
    repoPath: string,
    campaign: TestCampaign,
    /** Prédicat déjà lu par l'appelant (`approvalPredicate`), pour ne pas relire le schéma. */
    approved?: (test: TestCase) => boolean,
  ): Promise<Map<string, { test: TestCase; resyncable: boolean }>> {
    const isApproved = approved ?? await this.approvalPredicate(repoPath)
    const resyncable = new Set(campaign.runs.filter(r => isResyncable(campaign, r, isApproved)).map(r => r.entryId))
    const live = await this.snapshotsFor(
      repoPath,
      campaign.runs.filter(r => !r.testSnapshot || resyncable.has(r.entryId)).map(r => r.testCaseId),
    )
    const effective = new Map<string, { test: TestCase; resyncable: boolean }>()
    for (const run of campaign.runs) {
      const current = live.get(run.testCaseId)
      if (resyncable.has(run.entryId) && current) effective.set(run.entryId, { test: current, resyncable: true })
      else if (run.testSnapshot) effective.set(run.entryId, { test: run.testSnapshot, resyncable: false })
      else if (current) effective.set(run.entryId, { test: current, resyncable: false })
    }
    return effective
  }

  /** GH68 — prédicat « test dans un statut d'approbation de son type », schéma lu une fois. */
  async approvalPredicate(repoPath: string): Promise<(test: TestCase) => boolean> {
    const schema = await (this.schema
      ? this.schema.get(repoPath)
      : this.gitService.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    ).catch(() => null)
    return (test) => {
      const typeDef = schema ? findObjectTypeDef(schema, test.objectTypeRef, 'test') : null
      return isApprovalStatus(typeDef && typeDef !== 'unresolvable' ? typeDef : null, test.status)
    }
  }

  async addTests(
    repoPath: string,
    campaignId: string,
    testCaseIds: string[],
    paramValuesByTest?: Record<string, Record<string, string>>,
    workspaceDir?: string,
    reqInstances?: ReqInstanceSelection,
    /** GH64 — entrées reportées depuis d'autres campagnes. */
    carried?: CarriedEntrySelection[],
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)
      const original = historyBase(campaign)

      if (campaign.status === 'completed' || campaign.status === 'abandoned') {
        throw new Error(`Cannot add tests to a ${campaign.status} campaign`)
      }

      const existingIds = new Set([
        ...campaign.testCaseIds,
        ...campaign.runs.map(r => r.testCaseId),
      ])
      const candidates = [...new Set(testCaseIds)]
      const snapshots = await this.snapshotsFor(repoPath, candidates)
      const previews = await this.previewsFor(repoPath, snapshots, campaign.baselineRef, workspaceDir)
      // T179 — un test itérant (`{req.…}` avec exigences liées) déjà présent reste ajoutable pour
      // ses exigences sans instance : la déduplication porte sur le couple (test, exigence).
      const newIds = candidates.filter(id => !existingIds.has(id) || !!previews.get(id)?.requirements?.length)
      if (newIds.length === 0 && !carried?.length) return campaign

      const before = campaign.runs.length
      const alloc = entryAllocator(campaign.runs, campaign.removedRuns, new Date().toISOString())
      campaign.runs = this.buildNewRuns(campaign.runs, alloc, newIds, paramValuesByTest, snapshots, previews, reqInstances)
      // GH64 — entrées reportées, dédoublonnées contre l'existant et l'onglet Tests.
      campaign.runs.push(...await this.buildCarriedRuns(repoPath, campaignId, campaign.runs, alloc, carried, campaign.baselineRef, workspaceDir))
      if (campaign.runs.length === before) return campaign
      campaign.testCaseIds = [...campaign.testCaseIds, ...campaign.runs.slice(before).map(r => r.testCaseId)]

      return this.persist(repoPath, campaignId, original, campaign)
    })
  }

  /**
   * Ajoute une nouvelle instance d'un test déjà présent dans la campagne (test paramétré
   * testé avec des valeurs différentes) — contrairement à `addTests()`, ne déduplique pas :
   * c'est tout l'intérêt de cette méthode (T97 sprint 2).
   */
  async duplicateTest(
    repoPath: string,
    campaignId: string,
    testCaseId: string,
    paramValues: Record<string, string>,
    workspaceDir?: string,
    requirementId?: string,
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)
      const original = historyBase(campaign)

      if (campaign.status === 'completed' || campaign.status === 'abandoned') {
        throw new Error(`Cannot add tests to a ${campaign.status} campaign`)
      }

      const snapshots = await this.snapshotsFor(repoPath, [testCaseId])
      const previews = await this.previewsFor(repoPath, snapshots, campaign.baselineRef, workspaceDir)
      const linked = previews.get(testCaseId)?.requirements
      if (requirementId && linked && !linked.some(r => r.requirementId === requirementId)) {
        // Lien retiré ou exigence devenue terminale depuis l'ajout : rien à dupliquer.
        throw new Error(`Requirement ${requirementId} is no longer linked to ${testCaseId}`)
      }
      const before = campaign.runs.length
      // T179 — duplicata d'une instance générée : même exigence, valeurs relues à la source ;
      // instance sans exigence : une seule nouvelle instance, même pour un test itérant.
      const alloc = entryAllocator(campaign.runs, campaign.removedRuns, new Date().toISOString())
      campaign.runs = this.buildNewRuns(
        campaign.runs, alloc, [testCaseId], { [testCaseId]: paramValues }, snapshots, previews,
        requirementId ? { [testCaseId]: [{ requirementId, paramValues }] } : undefined,
        { allowExisting: true, single: !requirementId },
      )
      campaign.testCaseIds = [...campaign.testCaseIds, ...campaign.runs.slice(before).map(r => r.testCaseId)]

      return this.persist(repoPath, campaignId, original, campaign)
    })
  }

  /**
   * T171 — prévisualisation de la résolution des paramètres pour des tests à ajouter (ou pour une
   * nouvelle campagne), sans écriture : alimente le panneau d'ajout, le formulaire de création
   * et la notification « avant validation ». Source : `baselineRef` fourni, sinon celui de la
   * campagne `campaignId`, sinon l'état courant.
   */
  async previewParams(
    repoPath: string,
    source: { campaignId?: string; baselineRef?: string },
    testCaseIds: string[],
    workspaceDir?: string,
  ): Promise<ParamResolutionPreview[]> {
    const baselineRef = source.baselineRef
      ?? (source.campaignId ? (await this.get(repoPath, source.campaignId)).baselineRef : undefined)
    const snapshots = await this.snapshotsFor(repoPath, testCaseIds)
    const previews = await this.previewsFor(repoPath, snapshots, baselineRef, workspaceDir)
    return [...previews.values()]
  }

  async updateRunParams(
    repoPath: string,
    campaignId: string,
    entryId: string,
    paramValues: Record<string, string>,
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)
      const original = historyBase(campaign)

      const runIndex = campaign.runs.findIndex(r => r.entryId === entryId)
      if (runIndex === -1) throw new Error(`Entry ${entryId} not found in campaign ${campaignId}`)

      campaign.runs[runIndex] = { ...campaign.runs[runIndex], paramValues }

      return this.persist(repoPath, campaignId, original, campaign)
    })
  }

  /**
   * Retire des instances de test de la campagne, identifiées par `entryId` (pas
   * `testCaseId`) — un même test peut être présent plusieurs fois (T97 sprint 2), donc
   * retirer par `testCaseId` supprimerait toutes ses instances au lieu d'une seule.
   * Une seule occurrence de `testCaseId` est retirée de `testCaseIds` par entrée retirée.
   */
  async removeEntries(
    repoPath: string,
    campaignId: string,
    entryIds: string[],
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)
      const original = historyBase(campaign)

      if (campaign.status === 'completed' || campaign.status === 'abandoned') {
        throw new Error(`Cannot remove tests from a ${campaign.status} campaign`)
      }

      const toRemove = new Set(entryIds)
      const removedRuns = campaign.runs.filter(r => toRemove.has(r.entryId))
      campaign.runs = campaign.runs.filter(r => !toRemove.has(r.entryId))
      // GH73 — l'entrée retirée est conservée (datée) : l'historique d'avant le retrait reste juste
      // et son `entryId` n'est jamais réattribué.
      if (removedRuns.length > 0) {
        const removedAt = new Date().toISOString()
        campaign.removedRuns = [...(campaign.removedRuns ?? []), ...removedRuns.map(r => ({ ...r, removedAt }))]
      }

      const testCaseIds = [...campaign.testCaseIds]
      for (const run of removedRuns) {
        const idx = testCaseIds.indexOf(run.testCaseId)
        if (idx !== -1) testCaseIds.splice(idx, 1)
      }
      campaign.testCaseIds = testCaseIds

      return this.persist(repoPath, campaignId, original, campaign)
    })
  }

  /** GH77 — cf. `RequirementsService.renameFieldKeys`. */
  async renameFieldKeys(repoPath: string, objectTypeRef: string, renames: FieldRename[], result: FieldRenameResult): Promise<void> {
    return this.rewriteObjects(repoPath, objectTypeRef, c => renameFieldKeys(c, renames), result)
  }

  /** GH77/GH82 — cf. `RequirementsService.rewriteObjects`. */
  async rewriteObjects(
    repoPath: string, objectTypeRef: string,
    transform: (campaign: TestCampaign) => TestCampaign | 'conflict' | null, result: FieldRenameResult,
  ): Promise<void> {
    const matching = (await this.list(repoPath)).filter(c => c.objectTypeRef === objectTypeRef)
    for (const { id } of matching) {
      try {
        await this.enqueue(repoPath, id, async () => {
          const next = transform(await this.get(repoPath, id))
          if (next === 'conflict') result.skipped.push({ id, reason: 'target_exists' })
          if (!next || next === 'conflict') return
          await this.persist(repoPath, id, historyBase(next), next, { raw: true })
          result.migrated.push(id)
        })
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  /**
   * GH82 — réécrit les copies `testSnapshot` des entrées dont le test est de type `testTypeRef`,
   * dans toutes les campagnes du repo (renommage d'un statut ou d'une valeur du type de test : seule
   * la clé change, pas le contenu figé). Écriture brute ; la campagne compte parmi les objets migrés.
   * GH100 — `onlyIds` : seulement les copies de ces tests (renommage de type appliqué aux campagnes
   * des autres repos, où `testTypeRef` peut désigner le type homonyme d'un autre repo).
   */
  async rewriteSnapshots(
    repoPath: string, testTypeRef: string, transform: (snapshot: TestCase) => TestCase | null, result: FieldRenameResult,
    onlyIds?: ReadonlySet<string>,
  ): Promise<void> {
    for (const { id } of await this.list(repoPath)) {
      try {
        await this.enqueue(repoPath, id, async () => {
          const campaign = await this.get(repoPath, id)
          let count = 0
          const rewrite = <R extends CampaignTestRun>(run: R): R => {
            if (!run.testSnapshot || run.testSnapshot.objectTypeRef !== testTypeRef) return run
            if (onlyIds && !onlyIds.has(run.testSnapshot.id)) return run
            const next = transform(run.testSnapshot)
            if (!next) return run
            count++
            return { ...run, testSnapshot: next }
          }
          const runs = campaign.runs.map(rewrite)
          // GH73 — les entrées retirées gardent leur copie : migrées aussi (données brutes exposées).
          const removedRuns = campaign.removedRuns?.map(rewrite)
          if (count === 0) return
          const updated = { ...campaign, runs, ...(removedRuns && { removedRuns }) }
          await this.persist(repoPath, id, historyBase(updated), updated, { raw: true })
          result.snapshots = (result.snapshots ?? 0) + count
          if (!result.migrated.includes(id)) result.migrated.push(id)
        })
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  /** GH77 — cf. `RequirementsService.updateHistory`. */
  async updateHistory(repoPath: string, id: string, next: (current: TestCampaign) => ObjectHistory | null): Promise<boolean> {
    return this.enqueue(repoPath, id, async () => {
      const existing = await this.get(repoPath, id).catch(() => null)
      const history = existing ? next(existing) : null
      if (!existing || !history) return false
      const updated = { ...existing, history }
      await this.persist(repoPath, id, historyBase(updated), updated, { raw: true })
      return true
    })
  }

  /**
   * Seule écriture d'un fichier de campagne (GH77) : complète l'historique du statut et des champs
   * suivis (`before` null = création) avant d'écrire.
   */
  private async persist(
    repoPath: string, id: string, before: HistoryCarrier | null, after: TestCampaign,
    /** Écriture qui ne change aucune valeur (renommage, reprise git) : `history` écrit tel quel. */
    opts: { raw?: boolean } = {},
  ): Promise<TestCampaign> {
    // GH195 — liens normalisés, `requiredWhen` contrôlé (lève FieldWriteError).
    if (!opts.raw) after = await applyFieldsWrite(this.gitService, repoPath, before, after)
    const stamped = this.history && !opts.raw
      ? await this.history.stamp(repoPath, after.objectTypeRef, before, after, { filePath: `campaigns/${id}.yaml` })
      : after
    await this.gitService.writeYaml(repoPath, `campaigns/${id}.yaml`, stamped)
    return stamped
  }

  async delete(repoPath: string, id: string): Promise<void> {
    await deleteWithTombstone(this.gitService, repoPath, `campaigns/${id}.yaml`, id)
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Construit les nouvelles entrées `CampaignTestRun` pour `newTestCaseIds`, avec un
   * `entryId` unique par instance (`${testCaseId}-${n}`, n = plus grand suffixe de ce testCaseId
   * parmi les instances existantes et celles ajoutées dans le même appel, + 1 — GH66), et copie
   * complète du test au moment de l'ajout dans `testSnapshot` (T49) — fige le contenu
   * indépendamment des modifications ultérieures de la source.
   */
  private buildNewRuns(
    /** Entrées actives, pour la déduplication (une entrée retirée ne bloque pas le ré-ajout). */
    existingRuns: CampaignTestRun[],
    alloc: EntryAllocator,
    newTestCaseIds: string[],
    paramValuesByTest: Record<string, Record<string, string>> | undefined,
    snapshots: Map<string, TestCase>,
    previews: Map<string, ParamResolutionPreview> = new Map(),
    reqInstances?: ReqInstanceSelection,
    /** `allowExisting` : instance ajoutée même si le couple (test, exigence) existe (duplicata) ;
     *  `single` : une seule instance sans exigence, sans itérer. */
    opts: { allowExisting?: boolean; single?: boolean } = {},
  ): CampaignTestRun[] {
    const newRun = (tcId: string, given: Record<string, string> | undefined, requirementId?: string) =>
      this.makeRun(alloc, tcId, given, requirementId, snapshots, previews)

    const newRuns: CampaignTestRun[] = []
    for (const tcId of newTestCaseIds) {
      const linked = previews.get(tcId)?.requirements
      if (!linked?.length || opts.single) {
        newRuns.push(newRun(tcId, paramValuesByTest?.[tcId]))
        continue
      }
      // T179 §4 — test itérant : une instance par exigence retenue (sélection absente : toutes),
      // hors exigences qui en ont déjà une (sauf duplicata explicite). Une exigence sélectionnée
      // mais plus liée (sélection périmée) est ignorée.
      const selection = reqInstances?.[tcId]
      const wanted = selection
        ? selection.filter(s => linked.some(r => r.requirementId === s.requirementId))
        : linked.map(r => ({ requirementId: r.requirementId, paramValues: paramValuesByTest?.[tcId] }))
      const done = new Set<string>()
      for (const { requirementId, paramValues } of wanted) {
        if (done.has(requirementId)) continue
        done.add(requirementId)
        const present = [...existingRuns, ...newRuns].some(r => r.testCaseId === tcId && r.requirementId === requirementId)
        if (present && !opts.allowExisting) continue
        newRuns.push(newRun(tcId, paramValues ?? paramValuesByTest?.[tcId], requirementId))
      }
    }

    return [...existingRuns, ...newRuns]
  }

  /**
   * GH64 — instances reportées depuis d'autres campagnes. Le renderer n'envoie que des références
   * (campagne, entrée) et les saisies de l'étape 2 : test et exigence sont relus dans la campagne
   * source. Une sélection invalide (source ou entrée introuvable, campagne cible elle-même, test
   * supprimé, exigence plus liée, doublon de l'existant) est ignorée sans faire échouer le reste —
   * comme un test supprimé entre l'affichage du panneau et l'appel (`snapshotsFor`). Paramètres de
   * la base relus selon `baselineRef` de la cible, jamais recopiés de la source. Renvoie les seules
   * nouvelles instances ; la campagne source n'est jamais modifiée.
   */
  private async buildCarriedRuns(
    repoPath: string,
    targetId: string | undefined,
    existingRuns: CampaignTestRun[],
    alloc: EntryAllocator,
    carried: CarriedEntrySelection[] | undefined,
    baselineRef: string | undefined,
    workspaceDir: string | undefined,
  ): Promise<CampaignTestRun[]> {
    if (!carried?.length) return []

    // Entrées source résolues. L'id de campagne vient du renderer et sert de nom de fichier :
    // seul un id simple est accepté (pas de chemin).
    const valid = carried.filter(sel => sel.campaignId !== targetId && /^[A-Za-z0-9_-]+$/.test(sel.campaignId))
    const ids = [...new Set(valid.map(sel => sel.campaignId))]
    // Campagne source supprimée entre l'affichage et l'appel : ignorée. Toute autre erreur de
    // lecture (YAML invalide…) remonte plutôt que de faire disparaître le report sans message.
    const loaded = await Promise.all(ids.map(id =>
      this.gitService.readYaml<TestCampaign>(repoPath, `campaigns/${id}.yaml`)
        .then(c => (c ? this.ensureEntryIds(c) : null))))
    const sources = new Map(ids.map((id, i) => [id, loaded[i]]))
    const picked: Array<{ sel: CarriedEntrySelection; source: CampaignTestRun }> = []
    for (const sel of valid) {
      const source = sources.get(sel.campaignId)?.runs.find(r => r.entryId === sel.entryId)
      if (source) picked.push({ sel, source })
    }
    if (picked.length === 0) return []

    const snapshots = await this.snapshotsFor(repoPath, picked.map(p => p.source.testCaseId))
    const previews = await this.previewsFor(repoPath, snapshots, baselineRef, workspaceDir)

    const keys = new Set(existingRuns.map(r => carryKey(r.testCaseId, r.requirementId, r.paramValues)))
    const newRuns: CampaignTestRun[] = []

    const add = (sel: CarriedEntrySelection, tcId: string, given: Record<string, string> | undefined, requirementId?: string) => {
      // Clé sur les valeurs telles qu'elles seront stockées (seules les références à saisir).
      const key = carryKey(tcId, requirementId, storedParamValues(previews.get(tcId), given))
      if (keys.has(key)) return
      keys.add(key)
      const run = this.makeRun(alloc, tcId, given, requirementId, snapshots, previews)
      run.carriedFrom = { campaignId: sel.campaignId, entryId: sel.entryId }
      newRuns.push(run)
    }

    for (const { sel, source } of picked) {
      const tcId = source.testCaseId
      if (!snapshots.has(tcId)) continue
      const preview = previews.get(tcId)
      const linked = preview?.requirements
      if (!preview) {
        // Sans résolution (service absent — MCP) : comportement T97, exigence de la source gardée.
        add(sel, tcId, sel.paramValues, source.requirementId)
      } else if (!linked?.length) {
        // Test (devenu) non itérant : instance sans exigence.
        add(sel, tcId, sel.paramValues)
      } else if (source.requirementId) {
        // Instance T179 : même exigence, si elle est encore liée (lue à la baseline cible).
        if (linked.some(r => r.requirementId === source.requirementId)) add(sel, tcId, sel.paramValues, source.requirementId)
      } else {
        // Entrée sans exigence d'un test devenu itérant : exigences retenues (absent : toutes).
        const wanted = sel.reqInstances ?? linked.map(r => ({ requirementId: r.requirementId, paramValues: sel.paramValues }))
        for (const w of wanted) {
          if (linked.some(r => r.requirementId === w.requirementId)) add(sel, tcId, w.paramValues ?? sel.paramValues, w.requirementId)
        }
      }
    }
    return newRuns
  }

  /**
   * Nouvelle entrée `pending` d'un test : `entryId` unique (`${testCaseId}-${n}`, `alloc.counts` =
   * plus grand suffixe déjà attribué par test, mis à jour — cf. `entryAllocator`), `addedAt`, copie du test (T49), paramètres résolus (T171) et valeurs
   * `{req.<champ>}` de l'exigence de l'instance (T179). Partagé par `buildNewRuns` et
   * `buildCarriedRuns` (GH64).
   */
  private makeRun(
    alloc: EntryAllocator,
    tcId: string,
    given: Record<string, string> | undefined,
    requirementId: string | undefined,
    snapshots: Map<string, TestCase>,
    previews: Map<string, ParamResolutionPreview>,
  ): CampaignTestRun {
    const n = (alloc.counts.get(tcId) ?? 0) + 1
    alloc.counts.set(tcId, n)
    const run: CampaignTestRun = {
      entryId: `${tcId}-${n}`,
      testCaseId: tcId,
      ...(requirementId && { requirementId }),
      testSnapshot: snapshots.get(tcId),
      status: 'pending',
      addedAt: alloc.addedAt,
    }
    const preview = previews.get(tcId)
    if (!preview) {
      // Sans résolution (service absent, test introuvable) : comportement T97 inchangé.
      if (given) run.paramValues = given
      return run
    }
    // T171 §6 — seules les références à saisir gardent une valeur manuelle : une référence ne
    // figure jamais à la fois dans `paramValues` et dans `resolvedParams`. Toute référence à
    // saisir est conservée, vide si le renderer n'en a pas fourni (prévisualisation périmée) :
    // elle reste ainsi visible et modifiable (`updateRunParams`) au lieu de disparaître.
    const manual = storedParamValues(preview, given) ?? {}
    // T179 — valeurs `{req.<champ>}` de l'exigence de l'instance, figées avec celles de la base.
    const inst = requirementId ? preview.requirements?.find(r => r.requirementId === requirementId) : undefined
    const resolved = { ...preview.resolved, ...inst?.resolved }
    const unresolved = [...preview.unresolved, ...(inst?.unresolved ?? [])]
    if (!inst && preview.requirements?.length) {
      // Instance sans exigence d'un test itérant (duplicata d'une instance antérieure) : ses
      // `{req.…}` n'ont pas de valeur — non résolues, jamais à saisir.
      const t = snapshots.get(tcId)
      for (const f of t ? extractTestReqRefs(t) : []) unresolved.push({ ref: REQ_REF_PREFIX + f, reason: 'no_linked_requirement' })
    }
    if (Object.keys(manual).length > 0) run.paramValues = manual
    if (Object.keys(resolved).length > 0) run.resolvedParams = resolved
    if (preview.sourceRef) run.paramSourceRef = preview.sourceRef
    if (unresolved.length > 0) run.unresolvedParams = unresolved
    return run
  }

  /**
   * Résout l'objet `TestCase` complet de chaque id, pour figer une copie dans `testSnapshot`
   * au moment de l'inclusion dans la campagne (T49) — pas de vérification de statut ici,
   * le gating "test approuvé" reste une contrainte côté renderer (panneau d'ajout), cohérent
   * avec le fait que la création de campagne (`campaign.new.tsx`) n'en applique déjà aucun.
   *
   * Un id qui ne résout plus (ex. test supprimé entre l'affichage du panneau d'ajout côté
   * renderer et cet appel) est silencieusement omis de la map plutôt que de faire échouer
   * tout l'ajout groupé — avant T49, un `testCaseId` invalide n'empêchait jamais `addTests`/
   * `create`/`duplicateTest` de réussir (seul l'affichage l'ignorait). L'entrée correspondante
   * se retrouve simplement sans `testSnapshot`, avec le même repli sur résolution live que les
   * entrées créées avant ce ticket.
   */
  /** Résolution des paramètres pour chaque test trouvé (vide sans ParametersService). */
  private async previewsFor(
    repoPath: string,
    snapshots: Map<string, TestCase>,
    baselineRef: string | undefined,
    workspaceDir: string | undefined,
  ): Promise<Map<string, ParamResolutionPreview>> {
    if (!this.parameters || snapshots.size === 0) return new Map()
    const previews = await this.parameters.previewForTests(repoPath, [...snapshots.values()], { baselineRef, workspaceDir })
    return new Map(previews.map(p => [p.testCaseId, p]))
  }

  private async snapshotsFor(repoPath: string, testCaseIds: string[]): Promise<Map<string, TestCase>> {
    const uniqueIds = [...new Set(testCaseIds)]
    const found = await Promise.all(
      uniqueIds.map(id => this.testsService.findOne(repoPath, id).catch(() => undefined)),
    )
    const snapshots = new Map<string, TestCase>()
    uniqueIds.forEach((id, i) => {
      const test = found[i]
      // GH77 — la copie figée ne porte pas l'historique du test (spec §11).
      if (test) snapshots.set(id, withoutHistory(test) as TestCase)
    })
    return snapshots
  }

  /**
   * Compatibilité ascendante : les campagnes créées avant l'introduction d'`entryId`
   * (T97 sprint 2) ont des `runs[]` sans ce champ. Backfill déterministe en mémoire à la
   * lecture (même schéma `${testCaseId}-${n}` que `buildNewRuns`, n = position parmi les
   * instances du même testCaseId, dans l'ordre du tableau) — pas de réécriture du fichier,
   * le calcul est stable/idempotent d'une lecture à l'autre tant que l'ordre de `runs[]`
   * ne change pas (il ne change jamais : les entrées ne sont qu'ajoutées, jamais réordonnées).
   */
  private ensureEntryIds(campaign: TestCampaign): TestCampaign {
    if (campaign.runs.every(r => r.entryId)) return campaign

    const counts = new Map<string, number>()
    campaign.runs = campaign.runs.map(r => {
      const n = (counts.get(r.testCaseId) ?? 0) + 1
      counts.set(r.testCaseId, n)
      return r.entryId ? r : { ...r, entryId: `${r.testCaseId}-${n}` }
    })
    return campaign
  }

  private nextCampaignId(repoPath: string): Promise<string> {
    return nextCounterId(this.gitService, repoPath, 'CAMP', 'campaigns')
  }
}

const RUN_RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'] as const satisfies readonly TestRunResult[]

/**
 * GH73 — attribution des nouvelles entrées d'une écriture : suffixes (GH66) calculés sur les entrées
 * actives **et retirées** — un `entryId` n'est jamais réutilisé, sinon un run rattaché par
 * `campaignEntry` serait attribué à la mauvaise instance —, date d'ajout commune. Un seul allocateur
 * par écriture, partagé par `buildNewRuns` et `buildCarriedRuns`.
 */
interface EntryAllocator { counts: Map<string, number>; addedAt: string }

function entryAllocator(runs: CampaignTestRun[], removed: RemovedCampaignTestRun[] | undefined, addedAt: string): EntryAllocator {
  return { counts: lastEntrySuffixes([...runs, ...(removed ?? [])]), addedAt }
}

/**
 * GH66 — plus grand suffixe `n` des `entryId` (`${testCaseId}-${n}`) par test. Numéroter à partir
 * du nombre d'instances redonnerait, après un retrait, un `entryId` encore porté par une autre
 * instance. Un `entryId` hors de ce format compte comme sa position parmi les instances du test
 * (schéma du backfill `ensureEntryIds`).
 */
function lastEntrySuffixes(runs: CampaignTestRun[]): Map<string, number> {
  const last = new Map<string, number>()
  const seen = new Map<string, number>()
  for (const r of runs) {
    const position = (seen.get(r.testCaseId) ?? 0) + 1
    seen.set(r.testCaseId, position)
    const suffix = r.entryId?.startsWith(`${r.testCaseId}-`) ? r.entryId.slice(r.testCaseId.length + 1) : ''
    const n = /^\d+$/.test(suffix) ? Number(suffix) : position
    last.set(r.testCaseId, Math.max(last.get(r.testCaseId) ?? 0, n))
  }
  return last
}

/**
 * Valeurs saisies à la main telles que stockées sur une instance : avec une résolution (T171 §6),
 * exactement les références à saisir (vides si non fournies) ; sans, les valeurs données (T97).
 */
function storedParamValues(
  preview: ParamResolutionPreview | undefined,
  given: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return preview ? Object.fromEntries(preview.manual.map(k => [k, given?.[k] ?? ''])) : given
}

/**
 * GH68 — instance resynchronisable : `pending`, avec copie, campagne ouverte, copie hors statut
 * d'approbation. Sa version effective est l'état live du test jusqu'à la saisie du résultat (GH81).
 */
/** GH74 — exporté : indicateur `resyncable` du graphe de données (même règle que la resynchronisation). */
export function isResyncable(campaign: TestCampaign, run: CampaignTestRun, isApproved: (test: TestCase) => boolean): boolean {
  return (campaign.status === 'planned' || campaign.status === 'in_progress')
    && run.status === 'pending' && !!run.testSnapshot && !isApproved(run.testSnapshot)
}

/** GH77 — état « avant » d'une mutation, limité à ce que compare l'historique (pas de copie des entrées). */
function historyBase(campaign: TestCampaign): HistoryCarrier {
  return { status: campaign.status, fields: { ...campaign.fields }, history: campaign.history }
}
