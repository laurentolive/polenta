// GH278 — services réels de l'application pour les objets de la démo dont le contenu dérive de son
// état : version (analyse figée, gel, tag), validation (empreintes, copie à la signature), issue,
// version testée. Un refus de l'application fait échouer la génération : la démo ne peut pas contenir
// ce que l'application refuserait de créer. Mêmes classes que `main/container.ts`, sans fenêtre, sans
// compte et sans réseau.
import '../../apps/desktop/scripts/register-brand'
import type { HostContext } from '../../apps/desktop/src/main/host/host-context'
import { AuthService } from '../../apps/desktop/src/main/services/auth.service'
import { CampaignsService } from '../../apps/desktop/src/main/services/campaigns.service'
import { ExecutionHistoryService } from '../../apps/desktop/src/main/services/execution-history.service'
import { GitService } from '../../apps/desktop/src/main/services/git.service'
import { HistoryService } from '../../apps/desktop/src/main/services/history.service'
import { IssuesService } from '../../apps/desktop/src/main/services/issues.service'
import { PolentaRepoService } from '../../apps/desktop/src/main/services/polenta-repo.service'
import { RequirementsIndexService } from '../../apps/desktop/src/main/services/requirements-index.service'
import { RequirementsService } from '../../apps/desktop/src/main/services/requirements.service'
import { RevalidationService } from '../../apps/desktop/src/main/services/revalidation.service'
import { SchemaService } from '../../apps/desktop/src/main/services/schema.service'
import { SyncService } from '../../apps/desktop/src/main/services/sync.service'
import { TestedConfigService } from '../../apps/desktop/src/main/services/tested-config.service'
import { TestsIndexService } from '../../apps/desktop/src/main/services/tests-index.service'
import { TestsService } from '../../apps/desktop/src/main/services/tests.service'
import { TraceabilityService } from '../../apps/desktop/src/main/services/traceability.service'
import { TransitionGuardService } from '../../apps/desktop/src/main/services/transition-guard.service'
import { ValidationsService } from '../../apps/desktop/src/main/services/validations.service'
import { VersionTrackingService } from '../../apps/desktop/src/main/services/version-tracking.service'
import { VersionsService } from '../../apps/desktop/src/main/services/versions.service'
import { WorkspaceTreeService } from '../../apps/desktop/src/main/services/workspace-tree.service'

/** Pas de compte en génération : `getAuthor` retombe sur `user.name` du repo, posé par `asPerson`. */
const noAccounts: HostContext = {
  get userDataDir(): string { throw new Error('démo : pas de dossier utilisateur') },
  machineConfig: { hideGithub: false },
  tokenStore: {
    get: async () => { throw new Error('démo : pas de jeton') },
    set: async () => { throw new Error('démo : pas de jeton') },
    delete: async () => { throw new Error('démo : pas de jeton') },
  },
}

/** Graphe neuf à chaque appel : les index ne suivent pas les écritures faites hors des services. */
export function appServices(person: string) {
  const auth = new AuthService(noAccounts)
  const git = new GitService()
  const reqIndex = new RequirementsIndexService(git)
  const testsIndex = new TestsIndexService(git)
  const sync = new SyncService(auth)
  const workspaceTree = new WorkspaceTreeService(sync, new PolentaRepoService())
  const schema = new SchemaService(auth, workspaceTree)
  const history = new HistoryService(git, async () => ({ by: person }))
  const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree, history)
  const requirements = new RequirementsService(git, reqIndex, schema, revalidation, history)
  const tests = new TestsService(git, testsIndex, schema, revalidation, history)
  const campaigns = new CampaignsService(git, tests, undefined, schema, history)
  const traceability = new TraceabilityService(reqIndex, testsIndex, git, sync, workspaceTree)
  const versions = new VersionsService(
    git, sync, schema, new VersionTrackingService(git, schema), history, workspaceTree,
    (rootRepoPath, wsDir) => revalidation.readonlyRepoPaths(rootRepoPath, wsDir),
  )
  versions.setImpactSources({ traceability, campaigns })
  const testedConfig = new TestedConfigService(versions, sync, tests, campaigns)
  const issues = new IssuesService(git, schema, history, (r, wsDir) => versions.isReadonly(r, wsDir))
  const executions = new ExecutionHistoryService(tests, campaigns, requirements, testedConfig)
  const validations = new ValidationsService(git, sync, schema, versions, traceability, history, executions)
  const transitionGuard = new TransitionGuardService(traceability)
  for (const service of [requirements, tests, issues]) service.setTransitionGuard(transitionGuard)
  tests.setTestedConfig(testedConfig)
  return { git, sync, workspaceTree, schema, requirements, tests, campaigns, traceability, versions, testedConfig, issues, validations }
}

export type AppServices = ReturnType<typeof appServices>

/**
 * Exécute `fn` à l'instant `iso` : les services datent leurs écritures et leurs commits avec l'horloge
 * du système, et la démo raconte une histoire datée. L'horloge avance d'une seconde par lecture pour
 * garder l'ordre des entrées d'historique.
 */
export async function atInstant<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date
  let ms = RealDate.parse(iso)
  const tick = () => { const v = ms; ms += 1000; return v }
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(tick())
      else super(...(args as [string]))
    }
    static override now() { return tick() }
  }
  globalThis.Date = FixedDate as DateConstructor
  try {
    return await fn()
  } finally {
    globalThis.Date = RealDate
  }
}
