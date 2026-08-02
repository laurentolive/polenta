import type { Dashboard, WidgetFieldMapping, WidgetSize, WidgetType } from '@polenta/types'
import type { GitService } from './git.service'
import type { DashboardsService, AddWidgetDto, CreateDashboardDto } from './dashboards.service'
import type { SavedQueriesService, CreateSavedQueryDto } from './saved-queries.service'

const SEED_MARKER_PATH = 'dashboards/.seeded.yaml'

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
  ) {}

  async ensureSeeded(repoPath: string, username: string): Promise<void> {
    const existing = this.inFlightSeeds.get(repoPath)
    if (existing) return existing

    const attempt = this.doEnsureSeeded(repoPath, username).finally(() => {
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
    if (branch === '' || branch.startsWith('prj-')) return

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
}
