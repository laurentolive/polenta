import type { Dashboard, Widget, WidgetFieldMapping, WidgetSize, WidgetType } from '@polenta/types'
import type { GitService } from './git.service'
import type { DashboardsService, AddWidgetDto, CreateDashboardDto } from './dashboards.service'
import type { SavedQueriesService, CreateSavedQueryDto } from './saved-queries.service'
import { isReadonlyBranch } from './readonly-branch.util'
import { readPref, writePref } from './pref-store.util'

const SEED_MARKER_PATH = 'dashboards/.seeded.yaml'
/** GH65 — clé du `.{user}.pref` portant le marqueur du seed « Campagnes » (cf. ensureCampaignsSeeded). */
const CAMPAIGNS_SEED_PREF_KEY = 'campaignsSeed'

interface SeedQuery {
  key: string
  title: string
  sqlText: string
}

interface SeedWidget {
  title: string
  queryKey: string
  type: WidgetType
  fieldMapping: WidgetFieldMapping
  size: WidgetSize
}

interface SeedDashboard {
  title: string
  widgets: SeedWidget[]
}

// T77.md § Critères d'acceptation. SQL text mode is used throughout (rather than
// builderConfig) because these queries aggregate derived columns (coverageStatus,
// cf. query-engine.service.ts) that the guided builder's field picker doesn't
// currently surface (QueryBuilder.tsx lists a type's schema fields, not the
// query-engine's derived columns) — out of scope to extend this sprint, and SQL
// mode already has full access to every dataset column.
const SEED_QUERIES: SeedQuery[] = [
  {
    key: 'requirements-status-by-component',
    title: 'Exigences — statut par composant',
    sqlText:
      'SELECT [component], [status], COUNT(*) AS [count] FROM [requirements] GROUP BY [component], [status]',
  },
  {
    key: 'requirements-coverage-status-by-component',
    title: 'Exigences — statut de couverture par composant',
    sqlText:
      'SELECT [component], [coverageStatus], COUNT(*) AS [count] FROM [requirements] GROUP BY [component], [coverageStatus]',
  },
]

const SEED_DASHBOARDS: SeedDashboard[] = [
  {
    title: 'Status',
    widgets: [
      {
        title: 'Statut des exigences par composant',
        queryKey: 'requirements-status-by-component',
        type: 'bar',
        fieldMapping: { category: 'component', measure: 'count', series: 'status', stacked: true },
        size: 'lg',
      },
      {
        title: 'Statut de couverture des exigences par composant',
        queryKey: 'requirements-coverage-status-by-component',
        type: 'bar',
        fieldMapping: { category: 'component', measure: 'count', series: 'coverageStatus', stacked: true },
        size: 'lg',
      },
    ],
  },
]

// ─── GH65 — dashboard « Campagnes » ───────────────────────────────────────────
// Seed indépendant, PRIVÉ (`.{user}.pref`, ignoré par git) : livré à chaque utilisateur de tout
// projet, nouveau ou existant, sans rien écrire dans le repo. Un seed partagé aurait été créé par
// chaque membre de l'équipe sur son propre clone avant d'avoir récupéré celui des autres (doublons,
// conflits add/add sur queries/ et dashboards/), et ses fichiers non publiés auraient rendu le repo
// « sale » — ce qui bloque le pull automatique. L'utilisateur le partage s'il le souhaite (promotion
// des requêtes puis du dashboard, SPEC-DASHBOARDS §3.1). SQL avancé : les campagnes
// sans `objectTypeRef` (antérieures aux types de campagne) doivent être comptées. Les KPI groupent
// sur `campaignStatus` (une seule valeur après le WHERE) pour rendre ZÉRO ligne quand il n'y a rien à
// mesurer — sans GROUP BY, AlaSQL rend une ligne vide et le KPI afficherait 0 au lieu de son état vide.

type SeedLocale = 'fr' | 'en'

type CampaignSeedQueryKey = 'progress' | 'executedPct' | 'passPct' | 'perDay' | 'failures'

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
      executedPct: 'Campagnes en cours — % exécuté',
      passPct: 'Campagnes en cours — % PASS',
      perDay: 'Campagnes — exécutions par jour',
      failures: 'Campagnes en cours — entrées en échec',
    },
    widgets: {
      progress: 'Avancement par campagne',
      executedPct: '% exécuté',
      passPct: '% PASS',
      perDay: 'Exécutions par jour',
      failures: 'Entrées en échec',
    },
  },
  en: {
    dashboard: 'Campaigns',
    queries: {
      progress: 'Campaigns — progress',
      executedPct: 'Campaigns in progress — % executed',
      passPct: 'Campaigns in progress — % PASS',
      perDay: 'Campaigns — executions per day',
      failures: 'Campaigns in progress — failed entries',
    },
    widgets: {
      progress: 'Progress by campaign',
      executedPct: '% executed',
      passPct: '% PASS',
      perDay: 'Executions per day',
      failures: 'Failed entries',
    },
  },
}

/** GH65 — définition d'origine du widget « Avancement par campagne », pour la mise à niveau GH71. */
export const GH65_PROGRESS_SQL =
  "SELECT [campaignTitle], [status], COUNT(*) AS [count] FROM [campaign_entries] WHERE [campaignStatus] IN ('planned', 'in_progress') GROUP BY [campaignTitle], [status]"
export const GH65_PROGRESS_MAPPING: WidgetFieldMapping = { category: 'campaignTitle', measure: 'count', series: 'status', stacked: true }

/** GH71 — avancement de la définition des tests au résultat (étapes `campaign-progress.ts`). */
export const PROGRESS_SQL =
  "SELECT [campaignTitle], [progress], COUNT(*) AS [count] FROM [campaign_entries] WHERE [campaignStatus] IN ('planned', 'in_progress') GROUP BY [campaignTitle], [progress]"
export const PROGRESS_MAPPING: WidgetFieldMapping = {
  category: 'campaignTitle', measure: 'count', series: 'progress', stacked: true, preset: 'campaignProgress',
}
/** Titres d'origine (GH65) de la requête → titre actuel, appliqué à la mise à niveau. */
const GH65_PROGRESS_TITLES: Record<string, string> = {
  'Campagnes — avancement par statut': 'Campagnes — avancement',
  'Campaigns — progress by status': 'Campaigns — progress',
}
/** Mises à niveau des seeds « Campagnes » déjà créés, mémorisées dans le marqueur. */
const PROGRESS_UPGRADE = 'progressV2'

export const CAMPAIGN_SEED_QUERIES: { key: CampaignSeedQueryKey; sqlText: string }[] = [
  { key: 'progress', sqlText: PROGRESS_SQL },
  {
    key: 'executedPct',
    sqlText:
      "SELECT ROUND(100 * SUM(CASE WHEN [executed] = true THEN 1 ELSE 0 END) / COUNT(*), 1) AS [executedPct] FROM [campaign_entries] WHERE [campaignStatus] = 'in_progress' GROUP BY [campaignStatus]",
  },
  {
    key: 'passPct',
    sqlText:
      "SELECT ROUND(100 * SUM(CASE WHEN [status] = 'PASS' THEN 1 ELSE 0 END) / COUNT(*), 1) AS [passPct] FROM [campaign_entries] WHERE [campaignStatus] = 'in_progress' AND [executed] = true GROUP BY [campaignStatus]",
  },
  {
    key: 'perDay',
    sqlText:
      'SELECT [executedDay], COUNT(*) AS [count] FROM [campaign_entries] WHERE [executed] = true GROUP BY [executedDay] ORDER BY [executedDay]',
  },
  {
    key: 'failures',
    sqlText:
      "SELECT [campaignId], [campaignTitle], [entryId], [testCaseId], [testTitle], [status], [executedAt], [executedBy] FROM [campaign_entries] WHERE [campaignStatus] = 'in_progress' AND [status] IN ('FAIL', 'BLOCKED') ORDER BY [executedAt] DESC",
  },
]

const CAMPAIGN_SEED_WIDGETS: { queryKey: CampaignSeedQueryKey; type: WidgetType; fieldMapping: WidgetFieldMapping; size: WidgetSize }[] = [
  { queryKey: 'progress', type: 'bar', fieldMapping: PROGRESS_MAPPING, size: 'lg' },
  { queryKey: 'executedPct', type: 'kpi', fieldMapping: { measure: 'executedPct' }, size: 'sm' },
  { queryKey: 'passPct', type: 'kpi', fieldMapping: { measure: 'passPct' }, size: 'sm' },
  { queryKey: 'perDay', type: 'line', fieldMapping: { category: 'executedDay', measure: 'count' }, size: 'md' },
  {
    queryKey: 'failures',
    type: 'table',
    fieldMapping: { columns: ['campaignId', 'campaignTitle', 'entryId', 'testCaseId', 'testTitle', 'status', 'executedAt', 'executedBy'] },
    size: 'lg',
  },
]

/** Marqueur à reprise : ce qui a déjà été créé, pour qu'une relance après un échec ne duplique rien. */
export interface CampaignsSeedMarker {
  state: 'partial' | 'done'
  queries?: Partial<Record<CampaignSeedQueryKey, string>>
  dashboardId?: string
  widgets?: CampaignSeedQueryKey[]
  seededAt?: string
  /** GH71 — mises à niveau déjà appliquées (ou sans objet, seed créé aux définitions récentes). */
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
 * DashboardSeedService — T77 sprint 3 (T148: "Couverture"/"Avancement"/"Maturité"
 * removed, only "Status" remains seeded).
 *
 * Seeds the pre-configured shared dashboard(s) ("Status" — specs/T77.md § Critères
 * d'acceptation) the first time the "Suivi" panel is opened on a project whose
 * `dashboards/` folder is empty. Called from the `dashboards:list` IPC handler
 * (main process), not the renderer, so it's reliable even outside the UI (T77
 * sprint 3 instructions: "pas côté renderer").
 *
 * Deliberately NOT folded into DashboardsService itself: seeding needs to create both
 * SavedQuery and Dashboard/Widget objects, and DashboardsService must not depend on
 * SavedQueriesService — that dependency already runs the other way (SavedQueriesService
 * depends on DashboardsService for findDependentWidgets, see dashboards.service.ts's
 * header comment) to avoid a cycle. A small orchestrator depending on both, invoked
 * from the IPC layer that already holds both services, avoids the cycle entirely while
 * reusing their real CRUD (`create`/`addWidget`) instead of duplicating any
 * YAML-writing logic.
 *
 * **Known limitation, accepted for this sprint**: `dashboards:list` is currently the
 * ONLY entry point that seeds. A hypothetical future caller of
 * `DashboardsService.list()` that bypasses this IPC handler (a CLI tool, a test
 * harness) would silently miss the seed. Not folding this into `DashboardsService`
 * itself was a deliberate call to avoid the SavedQueriesService/DashboardsService
 * dependency cycle described above; revisit if a second caller of `list()` appears.
 *
 * "Once only" guarantee: T77-design.md's trigger is "dossier dashboards/ vide", but
 * that alone can't tell apart "never seeded" from "a user deleted every shared
 * dashboard on purpose" — both leave the folder empty — and the sprint 3 instructions
 * explicitly require the templates never come back once removed. A dotfile marker
 * (`dashboards/.seeded.yaml`), written ONLY once a full seed has actually succeeded,
 * resolves the ambiguity: deleting the seeded dashboards afterward leaves the
 * marker file untouched (a separate file), so it is never reseeded. The marker is
 * invisible to `DashboardsService.list()` / `readYamlDir()` (`GitService.listFiles`'s
 * directory walk skips dotfiles) but `readYaml()` (a direct path read) still sees it.
 * Deliberately NOT written on the "folder already non-empty" skip path (pre-existing
 * dashboards, or a previous seed attempt that failed partway) — see `ensureSeeded()`.
 */
export class DashboardSeedService {
  /** Guards against a TOCTOU race: two near-simultaneous `dashboards:list` calls (two
   *  windows on the same project, or a UI double-fetch) could otherwise both read "not
   *  seeded yet" before either has written anything, and both run the seed loop,
   *  producing duplicate dashboards/queries. Concurrent calls for the same repoPath
   *  share the same in-flight attempt instead. Cleared once the attempt settles (not
   *  kept forever) so a later call — e.g. after the user switches off a readonly
   *  branch, see below — re-checks real state rather than replaying a stale result. */
  private readonly inFlightSeeds = new Map<string, Promise<void>>()

  constructor(
    private readonly git: GitService,
    private readonly dashboards: DashboardsService,
    private readonly savedQueries: SavedQueriesService,
    /** GH65 — marqueur du seed « Campagnes » (défaut : `.{user}.pref`). */
    private readonly campaignsMarker: CampaignsSeedMarkerStore = prefMarkerStore,
  ) {}

  async ensureSeeded(repoPath: string, username: string, locale?: string): Promise<void> {
    const existing = this.inFlightSeeds.get(repoPath)
    if (existing) return existing

    const attempt = (async () => {
      await this.doEnsureSeeded(repoPath, username)
      // Seed facultatif : un échec ne doit pas empêcher de lister les dashboards (« Status »,
      // ceux de l'utilisateur). Retenté au prochain `dashboards:list` (marqueur à reprise).
      await this.ensureCampaignsSeeded(repoPath, username, seedLocale(locale)).catch((err) => {
        console.warn(`[dashboard-seed] seed « Campagnes » non terminé (${repoPath}) :`, err instanceof Error ? err.message : String(err))
      })
      await this.upgradeCampaignsSeed(repoPath, username).catch((err) => {
        console.warn(`[dashboard-seed] mise à niveau « Campagnes » non terminée (${repoPath}) :`, err instanceof Error ? err.message : String(err))
      })
    })().finally(() => {
      this.inFlightSeeds.delete(repoPath)
    })
    this.inFlightSeeds.set(repoPath, attempt)
    return attempt
  }

  private async doEnsureSeeded(repoPath: string, username: string): Promise<void> {
    const marker = await this.git.readYaml<{ seededAt: string }>(repoPath, SEED_MARKER_PATH)
    if (marker) return

    // `dashboards:list` used to be a pure read; seeding makes it a write. There is no
    // main-process enforcement of "readonly baseline/prj- branch" ANYWHERE in this
    // codebase today (`isReadonly` in VersioningContext.tsx is renderer-only, purely
    // decorative — a pre-existing gap across every write path, not something this
    // sprint introduces). But unlike every other write (an explicit user action on
    // whatever branch they're knowingly on), this one fires silently and automatically
    // the moment the panel opens — so it gets its own targeted guard rather than
    // writing queries + dashboards into a baseline that should never be touched.
    // No marker is written here: once the user switches to a writable branch, the next
    // `dashboards:list` call re-evaluates from scratch.
    const branch = await this.git.currentBranch(repoPath).catch(() => '')
    if (isReadonlyBranch(branch)) return

    const shared = await this.git.readYamlDir<Dashboard>(repoPath, 'dashboards')
    if (shared.length > 0) {
      // Dossier déjà non vide sans marqueur — soit des dashboards partagés
      // pré-existants (projet créé avant l'introduction de ce seed, ou créés
      // manuellement avant le premier accès à l'onglet), soit les restes d'une
      // tentative de seed précédente ayant échoué à mi-chemin. Dans les deux cas : ne
      // pas s'imposer dessus, ET ne pas écrire le marqueur — si le dossier redevient
      // vide plus tard (nettoyage manuel d'un seed partiel, ou l'utilisateur supprime
      // ses propres dashboards), un prochain appel retentera un seed complet plutôt
      // que de rester figé sur un état incomplet pour toujours.
      return
    }

    const queryIds = new Map<string, string>()
    for (const q of SEED_QUERIES) {
      const dto: CreateSavedQueryDto = {
        title: q.title,
        mode: 'sql',
        sqlText: q.sqlText,
        scope: 'shared',
        createdBy: username,
      }
      const created = await this.savedQueries.create(repoPath, username, dto)
      queryIds.set(q.key, created.id)
    }

    for (const d of SEED_DASHBOARDS) {
      const createDto: CreateDashboardDto = { title: d.title, scope: 'shared', createdBy: username }
      const dashboard = await this.dashboards.create(repoPath, username, createDto)
      for (const w of d.widgets) {
        const queryId = queryIds.get(w.queryKey)
        if (!queryId) continue // ne devrait jamais arriver (clés statiques ci-dessus) — défense
        const widgetDto: AddWidgetDto = {
          title: w.title,
          queryId,
          type: w.type,
          fieldMapping: w.fieldMapping,
          size: w.size,
        }
        await this.dashboards.addWidget(repoPath, username, dashboard.id, widgetDto)
      }
    }

    // Written ONLY on full success — see class doc comment for why the "folder
    // already non-empty" branch above must NOT write it too.
    await this.git.writeYaml(repoPath, SEED_MARKER_PATH, { seededAt: new Date().toISOString(), seededBy: username })
  }
  /**
   * GH65 — dashboard « Campagnes », créé une fois par utilisateur et par repo, en privé. Le marqueur
   * est écrit dès la première création (`state: partial`) et enrichi à chaque étape ; une relance
   * reprend là où l'échec s'est produit, sans doublon. `done` : plus jamais rien, même si
   * l'utilisateur supprime le dashboard. Rien n'est écrit dans le repo : pas de garde « branche en
   * lecture seule » (le `.pref` ne dépend pas de la branche).
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
      const created = await this.savedQueries.create(repoPath, username, {
        title: labels.queries[q.key],
        mode: 'sql',
        sqlText: q.sqlText,
        scope: 'private',
        createdBy: username,
      })
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
      await this.dashboards.addWidget(repoPath, username, dashboardId!, {
        title: labels.widgets[w.queryKey],
        queryId,
        type: w.type,
        fieldMapping: w.fieldMapping,
        size: w.size,
      })
      widgets.push(w.queryKey)
      save()
    }

    // GH71 — ids conservés (mises à niveau futures). Pas de marque de mise à niveau ici : un seed GH65
    // interrompu puis repris peut garder la requête ou le widget d'origine — `upgradeCampaignsSeed`,
    // appelé ensuite, les remet à niveau (sans effet sur un seed créé aux définitions récentes).
    this.campaignsMarker.write(repoPath, username, { state: 'done', seededAt: new Date().toISOString(), queries, dashboardId })
  }

  /**
   * GH71 — met à niveau le widget « Avancement par campagne » d'un seed GH65 déjà créé : étapes
   * d'avancement (`progress`, préréglage `campaignProgress`) au lieu du statut d'entrée. Une fois
   * par utilisateur et par repo. Le marqueur `done` des seeds GH65 n'ayant pas les ids, la requête est
   * retrouvée par son SQL exact (donc non modifiée) parmi les requêtes privées ; elle n'est mise à
   * niveau que si chaque widget qui l'utilise a le mapping d'origine ou le nouveau — sinon un widget
   * personnalisé (qui lit `status`) se retrouverait vide. Requête modifiée ou partagée : rien n'est
   * touché. Reprise sans perte après un échec en cours de route : une requête déjà passée au nouveau
   * SQL est reconnue aussi, et seuls les widgets restés à l'ancien mapping sont mis à jour.
   */
  private async upgradeCampaignsSeed(repoPath: string, username: string): Promise<void> {
    const marker = this.campaignsMarker.read(repoPath, username)
    if (marker?.state !== 'done' || marker.upgrades?.includes(PROGRESS_UPGRADE)) return

    const [queries, dashboards] = await Promise.all([
      this.savedQueries.list(repoPath, username),
      this.dashboards.list(repoPath, username),
    ])
    const hasMapping = (w: Widget, m: WidgetFieldMapping) => w.type === 'bar' && sameMapping(w.fieldMapping, m)
    for (const q of queries) {
      if (q.scope !== 'private' || q.mode !== 'sql' || (q.sqlText !== GH65_PROGRESS_SQL && q.sqlText !== PROGRESS_SQL)) continue
      const uses = dashboards.flatMap((d) => d.widgets.filter((w) => w.queryId === q.id).map((w) => ({ d, w })))
      if (uses.some(({ w }) => !hasMapping(w, GH65_PROGRESS_MAPPING) && !hasMapping(w, PROGRESS_MAPPING))) continue
      if (q.sqlText === GH65_PROGRESS_SQL) {
        const title = GH65_PROGRESS_TITLES[q.title]
        await this.savedQueries.update(repoPath, username, q.id, { sqlText: PROGRESS_SQL, ...(title && { title }) })
      }
      for (const { d, w } of uses) {
        if (hasMapping(w, GH65_PROGRESS_MAPPING)) await this.dashboards.updateWidget(repoPath, username, d.id, w.id, { fieldMapping: PROGRESS_MAPPING })
      }
    }
    this.campaignsMarker.write(repoPath, username, { ...marker, upgrades: [...(marker.upgrades ?? []), PROGRESS_UPGRADE] })
  }
}

/** Même mapping, ordre des clés et clés `undefined` indifférents. */
function sameMapping(a: WidgetFieldMapping, b: WidgetFieldMapping): boolean {
  const norm = (m: WidgetFieldMapping) =>
    JSON.stringify(Object.entries(m).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)))
  return norm(a) === norm(b)
}
