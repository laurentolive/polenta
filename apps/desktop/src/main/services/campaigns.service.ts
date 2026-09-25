import type { TestCampaign, CampaignStatus, CampaignTestRun, TestRunStatus, CreateCampaignDto, UpdateCampaignDto, TestCase, ParamResolutionPreview } from '@polenta/types'
import type { GitService } from './git.service'
import type { TestsService } from './tests.service'
import type { ParametersService } from './parameters.service'
import { nextCounterId } from './id-counter.util'

export class CampaignsService {
  constructor(
    private readonly gitService: GitService,
    private readonly testsService: TestsService,
    /** T171 — résolution des paramètres de la base à l'ajout ; absent (MCP) : comportement T97. */
    private readonly parameters?: ParametersService,
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

      // Filter by component if specified
      if (component && campaign.component !== component) continue
      // Filter by level if specified
      if (level && campaign.level !== level) continue

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

    const campaign: TestCampaign = {
      id,
      title: dto.title,
      objectTypeRef: dto.objectTypeRef,
      fields: dto.fields ?? {},
      level: dto.level,
      component: dto.component,
      baselineRef: dto.baselineRef,
      status: 'planned',
      testCaseIds,
      runs: this.buildNewRuns([], testCaseIds, dto.paramValuesByTest, snapshots, previews),
      createdAt: new Date().toISOString(),
      completedAt: null,
    }

    await this.gitService.writeYaml(repoPath, `campaigns/${id}.yaml`, campaign)
    return campaign
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

      await this.gitService.writeYaml(repoPath, `campaigns/${id}.yaml`, updated)
      return updated
    })
  }

  async updateRun(
    repoPath: string,
    campaignId: string,
    entryId: string,
    status: TestRunStatus,
    runId?: string,
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)

      const runIndex = campaign.runs.findIndex(r => r.entryId === entryId)
      if (runIndex === -1) throw new Error(`Entry ${entryId} not found in campaign ${campaignId}`)

      campaign.runs[runIndex] = {
        ...campaign.runs[runIndex],
        status,
        ...(runId && { runId }),
        executedAt: new Date().toISOString(),
      }

      // Auto-set status to in_progress if currently planned
      if (campaign.status === 'planned') {
        campaign.status = 'in_progress'
      }

      await this.gitService.writeYaml(repoPath, `campaigns/${campaignId}.yaml`, campaign)
      return campaign
    })
  }

  async close(
    repoPath: string,
    id: string,
    status: 'completed' | 'abandoned',
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, id, async () => {
      const campaign = await this.get(repoPath, id)

      campaign.status = status as CampaignStatus
      campaign.completedAt = new Date().toISOString()

      await this.gitService.writeYaml(repoPath, `campaigns/${id}.yaml`, campaign)
      return campaign
    })
  }

  async addTests(
    repoPath: string,
    campaignId: string,
    testCaseIds: string[],
    paramValuesByTest?: Record<string, Record<string, string>>,
    workspaceDir?: string,
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)

      if (campaign.status === 'completed' || campaign.status === 'abandoned') {
        throw new Error(`Cannot add tests to a ${campaign.status} campaign`)
      }

      const existingIds = new Set([
        ...campaign.testCaseIds,
        ...campaign.runs.map(r => r.testCaseId),
      ])
      const newIds = [...new Set(testCaseIds)].filter(id => !existingIds.has(id))
      if (newIds.length === 0) return campaign

      const snapshots = await this.snapshotsFor(repoPath, newIds)
      const previews = await this.previewsFor(repoPath, snapshots, campaign.baselineRef, workspaceDir)
      campaign.testCaseIds = [...campaign.testCaseIds, ...newIds]
      campaign.runs = this.buildNewRuns(campaign.runs, newIds, paramValuesByTest, snapshots, previews)

      await this.gitService.writeYaml(repoPath, `campaigns/${campaignId}.yaml`, campaign)
      return campaign
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
  ): Promise<TestCampaign> {
    return this.enqueue(repoPath, campaignId, async () => {
      const campaign = await this.get(repoPath, campaignId)

      if (campaign.status === 'completed' || campaign.status === 'abandoned') {
        throw new Error(`Cannot add tests to a ${campaign.status} campaign`)
      }

      const snapshots = await this.snapshotsFor(repoPath, [testCaseId])
      const previews = await this.previewsFor(repoPath, snapshots, campaign.baselineRef, workspaceDir)
      campaign.testCaseIds = [...campaign.testCaseIds, testCaseId]
      campaign.runs = this.buildNewRuns(campaign.runs, [testCaseId], { [testCaseId]: paramValues }, snapshots, previews)

      await this.gitService.writeYaml(repoPath, `campaigns/${campaignId}.yaml`, campaign)
      return campaign
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

      const runIndex = campaign.runs.findIndex(r => r.entryId === entryId)
      if (runIndex === -1) throw new Error(`Entry ${entryId} not found in campaign ${campaignId}`)

      campaign.runs[runIndex] = { ...campaign.runs[runIndex], paramValues }

      await this.gitService.writeYaml(repoPath, `campaigns/${campaignId}.yaml`, campaign)
      return campaign
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

      if (campaign.status === 'completed' || campaign.status === 'abandoned') {
        throw new Error(`Cannot remove tests from a ${campaign.status} campaign`)
      }

      const toRemove = new Set(entryIds)
      const removedRuns = campaign.runs.filter(r => toRemove.has(r.entryId))
      campaign.runs = campaign.runs.filter(r => !toRemove.has(r.entryId))

      const testCaseIds = [...campaign.testCaseIds]
      for (const run of removedRuns) {
        const idx = testCaseIds.indexOf(run.testCaseId)
        if (idx !== -1) testCaseIds.splice(idx, 1)
      }
      campaign.testCaseIds = testCaseIds

      await this.gitService.writeYaml(repoPath, `campaigns/${campaignId}.yaml`, campaign)
      return campaign
    })
  }

  async delete(repoPath: string, id: string): Promise<void> {
    await this.gitService.deleteFile(repoPath, `campaigns/${id}.yaml`)
  }

  // â”€â”€â”€ Private helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Construit les nouvelles entrées `CampaignTestRun` pour `newTestCaseIds`, avec un
   * `entryId` unique par instance (`${testCaseId}-${n}`, n = position parmi les instances
   * de ce testCaseId, existantes + nouvellement ajoutées dans le même appel), et copie
   * complète du test au moment de l'ajout dans `testSnapshot` (T49) — fige le contenu
   * indépendamment des modifications ultérieures de la source.
   */
  private buildNewRuns(
    existingRuns: CampaignTestRun[],
    newTestCaseIds: string[],
    paramValuesByTest: Record<string, Record<string, string>> | undefined,
    snapshots: Map<string, TestCase>,
    previews: Map<string, ParamResolutionPreview> = new Map(),
  ): CampaignTestRun[] {
    const counts = new Map<string, number>()
    for (const r of existingRuns) counts.set(r.testCaseId, (counts.get(r.testCaseId) ?? 0) + 1)

    const newRuns = newTestCaseIds.map(tcId => {
      const n = (counts.get(tcId) ?? 0) + 1
      counts.set(tcId, n)
      const run: CampaignTestRun = {
        entryId: `${tcId}-${n}`,
        testCaseId: tcId,
        testSnapshot: snapshots.get(tcId),
        status: 'pending' as TestRunStatus,
      }
      const preview = previews.get(tcId)
      const given = paramValuesByTest?.[tcId] ?? {}
      if (!preview) {
        // Sans résolution (service absent, test introuvable) : comportement T97 inchangé.
        if (paramValuesByTest?.[tcId]) run.paramValues = given
        return run
      }
      // T171 §6 — seules les références à saisir gardent une valeur manuelle : une référence ne
      // figure jamais à la fois dans `paramValues` et dans `resolvedParams`. Toute référence à
      // saisir est conservée, vide si le renderer n'en a pas fourni (prévisualisation périmée) :
      // elle reste ainsi visible et modifiable (`updateRunParams`) au lieu de disparaître.
      const manual = Object.fromEntries(preview.manual.map(k => [k, given[k] ?? '']))
      if (Object.keys(manual).length > 0) run.paramValues = manual
      if (Object.keys(preview.resolved).length > 0) run.resolvedParams = preview.resolved
      if (preview.sourceRef) run.paramSourceRef = preview.sourceRef
      if (preview.unresolved.length > 0) run.unresolvedParams = preview.unresolved
      return run
    })

    return [...existingRuns, ...newRuns]
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
      if (test) snapshots.set(id, test)
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
