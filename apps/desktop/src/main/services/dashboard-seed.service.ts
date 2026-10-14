import type { WidgetSize } from '@polenta/types'
import { legacyWidgetTemplate, stableJson } from '@polenta/types'
import type { GitService } from './git.service'
import type { DashboardsService } from './dashboards.service'
import type { SavedQueriesService } from './saved-queries.service'
import type { DashboardLibraryService } from './dashboard-library.service'
import type { TemplateInput } from './suivi-store.util'
import { listObjectEntries } from './suivi-store.util'
import { isReadonlyBranch } from './readonly-branch.util'
import { readPref, writePref } from './pref-store.util'

const SEED_MARKER_PATH = 'dashboards/.seeded.yaml'

/** Marqueur partagé `dashboards/.seeded.yaml` : seed Status (`seededAt`) et bibliothèque (`library`). */
export interface StatusSeedMarker {
  seededAt?: string
  seededBy?: string
  /** GH74 — objets créés par le seed Status (propositions de nouvelle version de modèle). */
  queries?: string[]
  dashboardId?: string
  /** GH74 §6.2 — fichiers de la bibliothèque de départ copiés (jamais recréés s'ils sont supprimés). */
  library?: string[]
}
/** GH65 — clé du `.{user}.pref` portant le marqueur du seed « Campagnes » (cf. ensureCampaignsSeeded). */
const CAMPAIGNS_SEED_PREF_KEY = 'campaignsSeed'

// GH74 — définitions des seeds en modèles (specs/GH74.md §8) : requêtes « Liste filtrée » /
// « Entrées de campagne », widgets barres / indicateur / courbe / table.

interface SeedQuery {
  key: string
  title: string
  template: TemplateInput
}

interface SeedWidget {
  title: string
  queryKey: string
  size: WidgetSize
  template: TemplateInput
}

const statusBar = (series: string): TemplateInput => ({
  id: 'bar',
  params: { category: 'component', series, measure: 'sum', measureColumn: 'count', stacked: true },
})

export const STATUS_SEED_QUERIES: SeedQuery[] = [
  {
    key: 'requirements-status-by-component',
    title: 'Exigences — statut par composant',
    template: { id: 'filtered-list', params: { category: 'requirement', groupBy: ['component', 'status'] } },
  },
  {
    key: 'requirements-coverage-status-by-component',
    title: 'Exigences — statut de couverture par composant',
    template: { id: 'filtered-list', params: { category: 'requirement', groupBy: ['component', 'coverageStatus'] } },
  },
]

const STATUS_SEED_WIDGETS: SeedWidget[] = [
  { title: 'Statut des exigences par composant', queryKey: 'requirements-status-by-component', size: 'lg', template: statusBar('status') },
  { title: 'Statut de couverture des exigences par composant', queryKey: 'requirements-coverage-status-by-component', size: 'lg', template: statusBar('coverageStatus') },
]

type SeedLocale = 'fr' | 'en'

type CampaignSeedQueryKey = 'progress' | 'executedPct' | 'passPct' | 'perDay' | 'failures' | 'timeline'

interface CampaignSeedLabels {
  dashboard: string
  queries: Record<CampaignSeedQueryKey, string>
  widgets: Record<CampaignSeedQueryKey, string>
}

const CAMPAIGN_SEED_LABELS: Record<SeedLocale, CampaignSeedLabels> = {
  fr: {
    dashboard: 'Campagnes',
    queries: {
      progress: 'Campagnes — avancement',
      executedPct: 'Campagnes en cours — entrées',
      passPct: 'Campagnes en cours — entrées exécutées',
      perDay: 'Campagnes — entrées exécutées',
      failures: 'Campagnes en cours — entrées en échec',
      timeline: 'Campagnes en cours — avancement dans le temps',
    },
    widgets: {
      progress: 'Avancement par campagne',
      executedPct: '% exécuté',
      passPct: '% PASS',
      perDay: 'Exécutions par jour',
      failures: 'Entrées en échec',
      timeline: 'Avancement dans le temps',
    },
  },
  en: {
    dashboard: 'Campaigns',
    queries: {
      progress: 'Campaigns — progress',
      executedPct: 'Campaigns in progress — entries',
      passPct: 'Campaigns in progress — executed entries',
      perDay: 'Campaigns — executed entries',
      failures: 'Campaigns in progress — failed entries',
      timeline: 'Campaigns in progress — progress over time',
    },
    widgets: {
      progress: 'Progress by campaign',
      executedPct: '% executed',
      passPct: '% PASS',
      perDay: 'Executions per day',
      failures: 'Failed entries',
      timeline: 'Progress over time',
    },
  },
}

const EXECUTED = ['INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS']

export const CAMPAIGN_SEED_QUERIES: { key: CampaignSeedQueryKey; template: TemplateInput }[] = [
  // Étape d'avancement (`entryStep` de la bibliothèque projet), ex-colonne `progress` (GH71).
  { key: 'progress', template: { id: 'campaign-entries', params: { campaignStatuses: ['planned', 'in_progress'], withStep: true } } },
  { key: 'executedPct', template: { id: 'campaign-entries', params: { campaignStatuses: ['in_progress'] } } },
  { key: 'passPct', template: { id: 'campaign-entries', params: { campaignStatuses: ['in_progress'], entryStatuses: EXECUTED } } },
  { key: 'perDay', template: { id: 'campaign-entries', params: { entryStatuses: EXECUTED } } },
  { key: 'failures', template: { id: 'campaign-entries', params: { campaignStatuses: ['in_progress'], entryStatuses: ['FAIL', 'BLOCKED'] } } },
  { key: 'timeline', template: { id: 'campaign-timeline', params: { campaignStatuses: ['in_progress'], step: '1' } } },
]

const CAMPAIGN_SEED_WIDGETS: { queryKey: CampaignSeedQueryKey; size: WidgetSize; template: TemplateInput }[] = [
  { queryKey: 'progress', size: 'lg', template: { id: 'bar', params: { category: 'campaignTitle', series: 'stepLabel', seriesOrder: 'stepRank', seriesColor: 'stepColor', measure: 'count', stacked: true } } },
  { queryKey: 'executedPct', size: 'sm', template: { id: 'kpi', params: { measure: 'ratio', measureColumn: 'executed', ratioValues: 'true' } } },
  { queryKey: 'passPct', size: 'sm', template: { id: 'kpi', params: { measure: 'ratio', measureColumn: 'status', ratioValues: 'PASS' } } },
  { queryKey: 'perDay', size: 'md', template: { id: 'line', params: { category: 'executedDay', measure: 'count', temporal: true } } },
  {
    queryKey: 'failures',
    size: 'lg',
    template: { id: 'table', params: { columns: ['campaignId', 'campaignTitle', 'entryId', 'testCaseId', 'testTitle', 'status', 'executedAt', 'executedBy'] } },
  },
  { queryKey: 'timeline', size: 'lg', template: { id: 'stacked-area', params: { x: 'date', series: 'status', value: 'count', entryColors: true } } },
]

/** GH74 §8 — widgets ajoutés aux seeds « Campagnes » existants via le bandeau (pas d'ajout silencieux). */
export const PROPOSED_SEED_WIDGETS: CampaignSeedQueryKey[] = ['timeline']

// ─── Seeds d'avant GH74 (requêtes SQL) : reconnus et réécrits ────────────────

/** SQL exact des requêtes seedées avant GH74 → requête actuelle. Une requête modifiée par
 *  l'utilisateur (SQL différent) n'est jamais reconnue : elle reste « non prise en charge ». */
const STATUS_LEGACY_SQL: Record<string, string> = {
  'SELECT [component], [status], COUNT(*) AS [count] FROM [requirements] GROUP BY [component], [status]': 'requirements-status-by-component',
  'SELECT [component], [coverageStatus], COUNT(*) AS [count] FROM [requirements] GROUP BY [component], [coverageStatus]': 'requirements-coverage-status-by-component',
}

const CAMPAIGN_LEGACY_SQL: Record<string, CampaignSeedQueryKey> = {
  // GH65, puis GH71 (étapes d'avancement).
  "SELECT [campaignTitle], [status], COUNT(*) AS [count] FROM [campaign_entries] WHERE [campaignStatus] IN ('planned', 'in_progress') GROUP BY [campaignTitle], [status]": 'progress',
  "SELECT [campaignTitle], [progress], COUNT(*) AS [count] FROM [campaign_entries] WHERE [campaignStatus] IN ('planned', 'in_progress') GROUP BY [campaignTitle], [progress]": 'progress',
  "SELECT ROUND(100 * SUM(CASE WHEN [executed] = true THEN 1 ELSE 0 END) / COUNT(*), 1) AS [executedPct] FROM [campaign_entries] WHERE [campaignStatus] = 'in_progress' GROUP BY [campaignStatus]": 'executedPct',
  "SELECT ROUND(100 * SUM(CASE WHEN [status] = 'PASS' THEN 1 ELSE 0 END) / COUNT(*), 1) AS [passPct] FROM [campaign_entries] WHERE [campaignStatus] = 'in_progress' AND [executed] = true GROUP BY [campaignStatus]": 'passPct',
  'SELECT [executedDay], COUNT(*) AS [count] FROM [campaign_entries] WHERE [executed] = true GROUP BY [executedDay] ORDER BY [executedDay]': 'perDay',
  "SELECT [campaignId], [campaignTitle], [entryId], [testCaseId], [testTitle], [status], [executedAt], [executedBy] FROM [campaign_entries] WHERE [campaignStatus] = 'in_progress' AND [status] IN ('FAIL', 'BLOCKED') ORDER BY [executedAt] DESC": 'failures',
}

/** Widgets seedés avant GH74 (type + mapping d'origine), pour ne réécrire que ceux restés intacts. */
const LEGACY_SEED_WIDGETS: { type: string; mapping: Record<string, unknown> }[] = [
  { type: 'bar', mapping: { category: 'component', measure: 'count', series: 'status', stacked: true } },
  { type: 'bar', mapping: { category: 'component', measure: 'count', series: 'coverageStatus', stacked: true } },
  { type: 'bar', mapping: { category: 'campaignTitle', measure: 'count', series: 'status', stacked: true } },
  { type: 'bar', mapping: { category: 'campaignTitle', measure: 'count', series: 'progress', stacked: true, preset: 'campaignProgress' } },
  { type: 'kpi', mapping: { measure: 'executedPct' } },
  { type: 'kpi', mapping: { measure: 'passPct' } },
  { type: 'line', mapping: { category: 'executedDay', measure: 'count' } },
  { type: 'table', mapping: { columns: ['campaignId', 'campaignTitle', 'entryId', 'testCaseId', 'testTitle', 'status', 'executedAt', 'executedBy'] } },
]

/** Paramètres de modèle d'un widget seedé d'avant GH74 resté intact (après conversion à la lecture). */
const LEGACY_SEED_WIDGET_PARAMS = new Set(LEGACY_SEED_WIDGETS.map((w) => {
  const t = legacyWidgetTemplate(w.type, w.mapping)!
  return `${t.id}\u0000${stableJson(t.params)}`
}))

/** Marqueur à reprise : ce qui a déjà été créé, pour qu'une relance après un échec ne duplique rien. */
export interface CampaignsSeedMarker {
  state: 'partial' | 'done'
  queries?: Partial<Record<CampaignSeedQueryKey, string>>
  dashboardId?: string
  widgets?: CampaignSeedQueryKey[]
  seededAt?: string
  /** Mises à niveau déjà appliquées (GH71, puis GH74). */
  upgrades?: string[]
}

/** Lecture/écriture du marqueur — injectable pour les tests ; par défaut, clé du `.{user}.pref`. */
export interface CampaignsSeedMarkerStore {
  read(repoPath: string, username: string): CampaignsSeedMarker | null
  write(repoPath: string, username: string, marker: CampaignsSeedMarker): void
}

const prefMarkerStore: CampaignsSeedMarkerStore = {
  read: (repoPath, username) => (readPref(repoPath, username)[CAMPAIGNS_SEED_PREF_KEY] as CampaignsSeedMarker | undefined) ?? null,
  write: (repoPath, username, marker) => {
    // Relu juste avant l'écriture : les services requêtes/dashboards écrivent le même fichier.
    writePref(repoPath, username, { ...readPref(repoPath, username), [CAMPAIGNS_SEED_PREF_KEY]: marker })
  },
}

/** Langue des libellés du seed (le main n'a pas d'i18next) : `en*` → anglais, sinon français. */
export function seedLocale(locale: string | undefined): SeedLocale {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

/**
 * DashboardSeedService — dashboards pré-configurés (SPEC-DASHBOARDS §5.1, §5.1b).
 *
 * - **Status** (partagé) : créé au premier accès à la vue Suivi si `dashboards/` ne contient aucun
 *   dashboard et n'a jamais été seedé (marqueur `dashboards/.seeded.yaml`, écrit seulement après un
 *   seed complet). Sauté (sans marqueur) sur une branche en lecture seule.
 * - **Campagnes** (privé, par utilisateur) : une fois par utilisateur et par repo, marqueur à reprise
 *   dans le `.pref`.
 *
 * Appelé par le handler `dashboards:list`. Constructions simultanées d'un même repo partagées.
 */
export class DashboardSeedService {
  private readonly inFlightSeeds = new Map<string, Promise<void>>()

  constructor(
    private readonly git: GitService,
    private readonly dashboards: DashboardsService,
    private readonly savedQueries: SavedQueriesService,
    /** GH65 — marqueur du seed « Campagnes » (défaut : `.{user}.pref`). */
    private readonly campaignsMarker: CampaignsSeedMarkerStore = prefMarkerStore,
    /** GH74 — bibliothèque de départ copiée avec le seed Status (absente : pas de copie). */
    private readonly library?: DashboardLibraryService,
  ) {}

  async ensureSeeded(repoPath: string, username: string, locale?: string): Promise<void> {
    const existing = this.inFlightSeeds.get(repoPath)
    if (existing) return existing
    const attempt = (async () => {
      await this.doEnsureSeeded(repoPath, username)
      await this.ensureLibrarySeeded(repoPath).catch((err) => {
        console.warn(`[dashboard-seed] copie de la bibliothèque non terminée (${repoPath}) :`, err instanceof Error ? err.message : String(err))
      })
      // Seed facultatif : un échec ne doit pas empêcher de lister les dashboards. Retenté au prochain
      // `dashboards:list` (marqueur à reprise).
      await this.ensureCampaignsSeeded(repoPath, username, seedLocale(locale)).catch((err) => {
        console.warn(`[dashboard-seed] seed « Campagnes » non terminé (${repoPath}) :`, err instanceof Error ? err.message : String(err))
      })
      await this.upgradeLegacySeeds(repoPath, username).catch((err) => {
        console.warn(`[dashboard-seed] mise à niveau des seeds d'avant GH74 non terminée (${repoPath}) :`, err instanceof Error ? err.message : String(err))
      })
    })().finally(() => {
      this.inFlightSeeds.delete(repoPath)
    })
    this.inFlightSeeds.set(repoPath, attempt)
    return attempt
  }

  private async doEnsureSeeded(repoPath: string, username: string): Promise<void> {
    const marker = await this.readStatusMarker(repoPath)
    // Marqueur sans `seededAt` : seule la bibliothèque a été copiée.
    if (marker?.seededAt) return
    // Écriture automatique à l'ouverture du panneau : jamais sur une branche en lecture seule (pas de
    // marqueur : retenté sur une branche inscriptible).
    const branch = await this.git.currentBranch(repoPath).catch(() => '')
    if (isReadonlyBranch(branch)) return
    // Dossier déjà non vide sans marqueur (dashboards pré-existants, ou seed précédent interrompu) :
    // rien, et pas de marqueur, pour retenter un seed complet si le dossier redevient vide.
    if ((await listObjectEntries(repoPath, 'dashboards', 'DASHBOARD')).length > 0) return

    const queryIds = new Map<string, string>()
    for (const q of STATUS_SEED_QUERIES) {
      const created = await this.savedQueries.create(repoPath, username, { title: q.title, template: q.template, scope: 'shared', createdBy: username })
      queryIds.set(q.key, created.id)
    }
    const dashboard = await this.dashboards.create(repoPath, username, { title: 'Status', scope: 'shared', createdBy: username })
    for (const w of STATUS_SEED_WIDGETS) {
      const queryId = queryIds.get(w.queryKey)
      if (!queryId) continue
      await this.dashboards.addWidget(repoPath, username, dashboard.id, { title: w.title, queryId, size: w.size, template: w.template })
    }
    // Écrit SEULEMENT après un seed complet (relu : la bibliothèque a pu y être notée entre-temps).
    await this.git.writeYaml(repoPath, SEED_MARKER_PATH, {
      ...(await this.readStatusMarker(repoPath)),
      seededAt: new Date().toISOString(), seededBy: username, queries: [...queryIds.values()], dashboardId: dashboard.id,
    })
  }

  readStatusMarker(repoPath: string): Promise<StatusSeedMarker | null> {
    return this.git.readYaml<StatusSeedMarker>(repoPath, SEED_MARKER_PATH)
  }

  /** Note dans le marqueur partagé des fichiers de bibliothèque copiés (mise à jour appliquée). */
  async recordLibraryFiles(repoPath: string, files: readonly string[]): Promise<void> {
    const marker = (await this.readStatusMarker(repoPath)) ?? {}
    const library = Array.from(new Set([...(marker.library ?? []), ...files])).sort()
    await this.git.writeYaml(repoPath, SEED_MARKER_PATH, { ...marker, library })
  }

  /** GH74 §6.2 — bibliothèque de départ, une fois par repo, même garde de branche que le seed Status. */
  private async ensureLibrarySeeded(repoPath: string): Promise<void> {
    if (!this.library) return
    const branch = await this.git.currentBranch(repoPath).catch(() => '')
    if (isReadonlyBranch(branch)) return
    const marker = await this.readStatusMarker(repoPath)
    await this.library.seedIfAbsent(repoPath, marker?.library ?? [], (files) => this.recordLibraryFiles(repoPath, files))
  }

  /** Marqueur du seed « Campagnes » de l'utilisateur (propositions du bandeau). */
  campaignsSeedMarker(repoPath: string, username: string): CampaignsSeedMarker | null {
    return this.campaignsMarker.read(repoPath, username)
  }

  /**
   * GH74 §8 — widgets du seed « Campagnes » absents d'un seed existant (terminé, dashboard toujours
   * là et modifiable) : proposés dans le bandeau.
   */
  async proposedSeedWidgets(repoPath: string, username: string): Promise<{ key: CampaignSeedQueryKey; dashboardId: string; dashboardTitle: string }[]> {
    const marker = this.campaignsMarker.read(repoPath, username)
    if (marker?.state !== 'done' || !marker.dashboardId) return []
    const dashboard = await this.dashboards.get(repoPath, username, marker.dashboardId)
    if (!dashboard || dashboard.state.readOnly) return []
    return PROPOSED_SEED_WIDGETS
      .filter((key) => !marker.queries?.[key])
      .map((key) => ({ key, dashboardId: dashboard.id, dashboardTitle: dashboard.title }))
  }

  /** Ajoute un widget proposé au dashboard « Campagnes » (requête privée créée avec lui). */
  async addProposedSeedWidget(repoPath: string, username: string, key: CampaignSeedQueryKey, locale?: string): Promise<void> {
    const proposal = (await this.proposedSeedWidgets(repoPath, username)).find((p) => p.key === key)
    if (!proposal) throw new Error(`Aucun widget « ${key} » à ajouter au dashboard Campagnes.`)
    const labels = CAMPAIGN_SEED_LABELS[seedLocale(locale)]
    const queryDef = CAMPAIGN_SEED_QUERIES.find((q) => q.key === key)!
    const widgetDef = CAMPAIGN_SEED_WIDGETS.find((w) => w.queryKey === key)!
    const query = await this.savedQueries.create(repoPath, username, { title: labels.queries[key], template: queryDef.template, scope: 'private', createdBy: username })
    try {
      await this.dashboards.addWidget(repoPath, username, proposal.dashboardId, { title: labels.widgets[key], queryId: query.id, size: widgetDef.size, template: widgetDef.template })
    } catch (err) {
      // Widget non ajouté : pas de requête orpheline, la proposition reste au bandeau.
      await this.savedQueries.delete(repoPath, username, query.id).catch(() => undefined)
      throw err
    }
    // Noté seulement une fois le widget ajouté (la proposition disparaît alors du bandeau).
    const marker = this.campaignsMarker.read(repoPath, username)!
    this.campaignsMarker.write(repoPath, username, { ...marker, queries: { ...marker.queries, [key]: query.id } })
  }

  /**
   * GH65 — dashboard « Campagnes », créé une fois par utilisateur et par repo, en privé. Le marqueur
   * est écrit dès la première création (`state: partial`) et enrichi à chaque étape ; une relance
   * reprend là où l'échec s'est produit, sans doublon. `done` : plus jamais rien, même si
   * l'utilisateur supprime le dashboard.
   */
  private async ensureCampaignsSeeded(repoPath: string, username: string, locale: SeedLocale): Promise<void> {
    const previous = this.campaignsMarker.read(repoPath, username)
    if (previous?.state === 'done') return

    const labels = CAMPAIGN_SEED_LABELS[locale]
    const queries: Partial<Record<CampaignSeedQueryKey, string>> = { ...previous?.queries }
    let dashboardId = previous?.dashboardId
    let widgets: CampaignSeedQueryKey[] = [...(previous?.widgets ?? [])]
    const save = () => this.campaignsMarker.write(repoPath, username, { state: 'partial', queries, dashboardId, widgets })

    for (const q of CAMPAIGN_SEED_QUERIES) {
      const knownId = queries[q.key]
      if (knownId && (await this.savedQueries.findOne(repoPath, username, knownId))) continue
      const created = await this.savedQueries.create(repoPath, username, { title: labels.queries[q.key], template: q.template, scope: 'private', createdBy: username })
      queries[q.key] = created.id
      save()
    }

    const existingDashboard = dashboardId ? await this.dashboards.get(repoPath, username, dashboardId) : null
    if (!existingDashboard) {
      const created = await this.dashboards.create(repoPath, username, { title: labels.dashboard, scope: 'private', createdBy: username })
      dashboardId = created.id
      widgets = []
      save()
    }

    for (const w of CAMPAIGN_SEED_WIDGETS) {
      const queryId = queries[w.queryKey]
      if (widgets.includes(w.queryKey) || !queryId) continue
      await this.dashboards.addWidget(repoPath, username, dashboardId!, { title: labels.widgets[w.queryKey], queryId, size: w.size, template: w.template })
      widgets.push(w.queryKey)
      save()
    }

    this.campaignsMarker.write(repoPath, username, { state: 'done', seededAt: new Date().toISOString(), queries, dashboardId, upgrades: ['gh74'] })
  }

  /**
   * GH74 — seeds créés avant GH74 (requêtes SQL, désormais non prises en charge) : chaque requête
   * reconnue à son SQL d'origine exact est remplacée par sa définition actuelle (même id), et chacun
   * de ses widgets resté au mapping d'origine passe au widget actuel. Requête ou widget modifiés :
   * rien n'est touché. Requêtes partagées (Status) : jamais sur une branche en lecture seule.
   * Idempotent (une requête remplacée n'est plus en SQL) : relancé à chaque `dashboards:list`.
   */
  private async upgradeLegacySeeds(repoPath: string, username: string): Promise<void> {
    const legacy = (await this.savedQueries.list(repoPath, username)).filter((q) => q.state.readOnly === 'legacy-sql' && q.legacySql)
    if (legacy.length === 0) return
    const branch = await this.git.currentBranch(repoPath).catch(() => '')
    const sharedWritable = !isReadonlyBranch(branch)
    const dashboards = await this.dashboards.list(repoPath, username)
    for (const q of legacy) {
      const statusKey = q.scope === 'shared' ? STATUS_LEGACY_SQL[q.legacySql!] : undefined
      const campaignKey = q.scope === 'private' ? CAMPAIGN_LEGACY_SQL[q.legacySql!] : undefined
      if (statusKey && !sharedWritable) continue
      const queryTemplate = statusKey
        ? STATUS_SEED_QUERIES.find((d) => d.key === statusKey)!.template
        : campaignKey ? CAMPAIGN_SEED_QUERIES.find((d) => d.key === campaignKey)!.template : undefined
      if (!queryTemplate) continue
      await this.savedQueries.update(repoPath, username, q.id, { template: queryTemplate }, { replaceLegacy: true })
      const widgetTemplate = statusKey
        ? STATUS_SEED_WIDGETS.find((w) => w.queryKey === statusKey)!.template
        : CAMPAIGN_SEED_WIDGETS.find((w) => w.queryKey === campaignKey)!.template
      for (const d of dashboards) {
        if (d.state.readOnly) continue
        for (const w of d.widgets) {
          if (w.queryId !== q.id || !w.template || w.state.customized) continue
          if (!LEGACY_SEED_WIDGET_PARAMS.has(`${w.template.id}\u0000${stableJson(w.template.params)}`)) continue
          await this.dashboards.updateWidget(repoPath, username, d.id, w.id, { template: widgetTemplate })
        }
      }
    }
  }
}
