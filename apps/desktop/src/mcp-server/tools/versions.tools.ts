import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { IMPACT_ANALYSIS_STATUSES, suggestVersionTag, type ImpactAnalysisStatus } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { componentRepoResolver, componentSchema, freshComponentRepoResolver, flattenComponents as flatten } from './component-repo'

/**
 * Versions de composant / produit : lecture (GH201 §8, GH245) et, depuis GH362, création,
 * alimentation, statut et passage released. Chaque outil appelle la méthode de service de l'IPC :
 * mêmes contrôles, mêmes erreurs (`CODE: détail`, renvoyées en `isError` par le SDK MCP).
 */
export function registerVersionTools(server: McpServer, container: McpContainer): void {
  const tree = () => container.versions.tree(container.repoPath, container.workspaceDir)
  const repoOf = componentRepoResolver(container)
  const writeRepo = freshComponentRepoResolver(container)
  const ws = container.workspaceDir

  server.registerTool(
    'list_versions',
    {
      title: 'List versions',
      description:
        'Versions de chaque composant (repo) du workspace, du plus récent au plus ancien : ID, label (`title`), ' +
        'statut, état (`in_progress` / `released` / `abandoned`), version précédente (`basedOn`), tag figé ' +
        '(`freeze`). Avec le nombre d’éléments au backlog. La version produit est celle du repo racine.',
      inputSchema: { component: componentSchema },
    },
    async ({ component }) => {
      const nodes = flatten(await tree()).filter(n => !component || n.name === component)
      return jsonToolResult(nodes.map(n => ({
        component: n.name, label: n.label, readonly: n.readonly, versionType: n.versionType?.ref ?? null,
        backlogCount: n.backlogCount, versions: n.versions,
      })))
    },
  )

  server.registerTool(
    'get_version',
    {
      title: 'Get version',
      description:
        'Une version : champs, composants (versions des dépendances retenues) et changements — ceux de la ' +
        'version et ceux des versions des composants postérieures à la version précédente (composant, version, ' +
        'type, ID, label, état de base `{ sha, version }` ; `toSha` = commit figé, null = état courant).',
      inputSchema: {
        id: z.string().describe('ID de la version (ex. VER-0004)'),
        component: componentSchema,
      },
    },
    async ({ id, component }) => {
      const page = await container.versions.page(await repoOf(component), id, ws)
      return jsonToolResult({
        version: page.version, state: page.state, component: page.component.name, basedOn: page.basedOn,
        components: page.components.map(c => ({ name: c.name, selected: c.selected })),
        changes: page.rows.map(({ repoPath: _repoPath, ...row }) => row),
      })
    },
  )

  server.registerTool(
    'get_version_backlog',
    {
      title: 'Get version backlog',
      description:
        'Backlog d’un composant : exigences et tests dont un changement n’a jamais été inclus dans une version ' +
        '(`kind: new` jamais livré, `modified` modifié depuis la dernière version released qui l’incluait, avec ' +
        '`base`) ; `outside` : approuvé modifié sans réouverture.',
      inputSchema: { component: componentSchema },
    },
    async ({ component }) => jsonToolResult(await container.versions.backlog(await repoOf(component))),
  )

  // GH245 — analyse d'impact et tests à exécuter d'une version (lecture).
  const idInput = {
    id: z.string().describe('ID de la version (ex. VER-0004)'),
    component: componentSchema,
  }

  server.registerTool(
    'get_version_impact',
    {
      title: 'Get version impact analysis',
      description:
        'Analyse d’impact d’une version (figée si released, sinon calculée sur l’état courant) : racines (éléments ' +
        'changés de la version et des versions de ses composants), lignes = éléments impactés du composant avec ' +
        'statut d’impact, commentaire, `reached` et `sources` (racine et chemin de liens). Arbres omis.',
      inputSchema: idInput,
    },
    async ({ id, component }) => {
      const a = await container.versions.analysis(await repoOf(component), id, ws)
      return jsonToolResult({
        computedAt: a.computedAt, frozen: a.frozen,
        roots: a.roots.map(r => ({ id: r.elementId, type: r.elementType, title: r.title, component: r.component })),
        rows: a.rows,
      })
    },
  )

  server.registerTool(
    'get_version_tests',
    {
      title: 'Get version tests to run',
      description:
        'Tests à exécuter pour une version : amenés par les changements et les impacts (sauf `pas_d_impact_reel`), ' +
        'instances par exigence (`requirementIds`), éléments sources, campagnes ouvertes du repo qui les ' +
        'contiennent déjà (`alreadyIn`, information) ; `uncovered` = exigences sans test.',
      inputSchema: idInput,
    },
    async ({ id, component }) => jsonToolResult(await container.versions.testsToRun(await repoOf(component), id, ws)),
  )

  // GH362 — écritures.
  const componentsSchema = z.record(z.string()).optional()
    .describe('Versions retenues des dépendances : { <nom de la dépendance>: <ID de sa version> }. Remplace la liste ' +
      'entière (une dépendance absente n’est plus retenue) : repartir de `components` de get_version.')
  const fieldsSchema = z.record(z.unknown()).optional().describe('Champs du type version (fusionnés avec l’existant)')
  const elementIdsSchema = z.array(z.string()).min(1).describe('IDs d’exigences / de tests du repo du composant')

  server.registerTool(
    'create_version',
    {
      title: 'Create version',
      description:
        'Crée une version en cours du composant (statut initial du type version). `title` = label, unique dans le ' +
        'composant ; `basedOn` = version précédente (released ou en cours — planification —, ni abandonnée ni descendante ; absent : dernière released) ; `components` = versions retenues des dépendances. Les ' +
        'changements s’ajoutent ensuite par `include_in_version` (cf. `get_version_backlog`).',
      inputSchema: {
        title: z.string().min(1).max(200),
        basedOn: z.string().nullable().optional().describe('ID de la version précédente (released ou en cours)'),
        components: componentsSchema,
        fields: fieldsSchema,
        component: componentSchema,
      },
    },
    async ({ title, basedOn, components, fields, component }) => jsonToolResult(await container.versions.create(
      await writeRepo(component),
      { title, ...(basedOn !== undefined && { basedOn }), ...(components && { components }), ...(fields && { fields }) },
      ws,
    )),
  )

  server.registerTool(
    'copy_version',
    {
      title: 'Copy version',
      description: 'Crée une nouvelle version en cours à partir d’une version existante (comme « Copier » dans l’application).',
      inputSchema: idInput,
    },
    async ({ id, component }) => jsonToolResult(await container.versions.copy(await writeRepo(component), id, ws)),
  )

  server.registerTool(
    'update_version',
    {
      title: 'Update version',
      description:
        'Modifie une version : label, version précédente, composants retenus, champs, statut. Les paramètres absents ' +
        'restent inchangés ; `fields` est fusionné, `components` remplacé. Le passage released passe par `release_version` (sinon `RELEASE_REQUIRED`). Une version ' +
        'released ne peut que passer au statut abandonné ; une version abandonnée ne revient pas (`VERSION_LOCKED`).',
      inputSchema: {
        ...idInput,
        title: z.string().min(1).max(200).optional(),
        basedOn: z.string().nullable().optional().describe('ID de la version précédente (released ou en cours, ni abandonnée ni descendante) ; null : aucune'),
        components: componentsSchema,
        fields: fieldsSchema,
        status: z.string().optional().describe('Statut du type version'),
      },
    },
    async ({ id, component, title, basedOn, components, fields, status }) => jsonToolResult(await container.versions.update(
      await writeRepo(component), id, { title, basedOn, components, fields, status }, ws,
    )),
  )

  server.registerTool(
    'include_in_version',
    {
      title: 'Include changes in version',
      description:
        'Ajoute des exigences / tests du composant aux changements d’une version en cours ; la base (état dans la ' +
        'dernière version released qui les incluait) est calculée. Refusé hors du composant (`NOT_OWN_ELEMENT`). ' +
        '`notFound` liste les IDs introuvables dans le repo, ignorés.',
      inputSchema: { ...idInput, elementIds: elementIdsSchema },
    },
    async ({ id, component, elementIds }) => {
      const version = await container.versions.include(await writeRepo(component), id, elementIds, ws)
      const included = new Set((version.changes ?? []).map(c => c.id))
      return jsonToolResult({ ...version, notFound: elementIds.filter(e => !included.has(e)) })
    },
  )

  server.registerTool(
    'remove_from_version',
    {
      title: 'Remove changes from version',
      description: 'Retire des éléments des changements d’une version en cours (ils retournent au backlog).',
      inputSchema: { ...idInput, elementIds: elementIdsSchema },
    },
    async ({ id, component, elementIds }) => jsonToolResult(await container.versions.removeChanges(await writeRepo(component), id, elementIds, ws)),
  )

  server.registerTool(
    'set_version_impact',
    {
      title: 'Set version impact status',
      description:
        'Renseigne le statut d’analyse d’impact d’un élément impacté (cf. `get_version_impact`) et un commentaire, ' +
        'sur une version en cours (`NOT_IN_PROGRESS` sinon). `impact_non_verifie` sans commentaire efface l’entrée.',
      inputSchema: {
        ...idInput,
        elementId: z.string(),
        status: z.enum(IMPACT_ANALYSIS_STATUSES as [ImpactAnalysisStatus, ...ImpactAnalysisStatus[]]),
        comment: z.string().nullable().optional(),
      },
    },
    async ({ id, component, elementId, status, comment }) => jsonToolResult(await container.versions.setImpact(
      await writeRepo(component), id, elementId, status, comment, ws,
    )),
  )

  server.registerTool(
    'get_version_release_preview',
    {
      title: 'Get version release preview',
      description:
        'Avant `release_version` : tag suggéré et problèmes qui bloqueraient le passage released (tag invalide ou ' +
        'pris, version pas en cours, composant non released, changement non commité `DIRTY_CHANGES`…).',
      inputSchema: { ...idInput, tag: z.string().optional().describe('Tag à tester ; absent : tag suggéré') },
    },
    async ({ id, component, tag }) => jsonToolResult(await container.versions.releasePreview(await writeRepo(component), id, ws, tag)),
  )

  server.registerTool(
    'release_version',
    {
      title: 'Release version',
      description:
        'IRRÉVERSIBLE — passe une version en cours au statut released : gel `freeze { tag, sha }` au HEAD, commit du ' +
        'seul fichier de la version, tag git annoté (poussé au prochain push du repo). La version n’est plus ' +
        'modifiable ensuite (seulement abandonnable). Appeler `get_version_release_preview` d’abord ; les changements ' +
        'inclus doivent être commités.',
      inputSchema: { ...idInput, tag: z.string().optional().describe('Tag git ; absent : tag suggéré') },
    },
    async ({ id, component, tag }) => {
      const repo = await writeRepo(component)
      // Même tag par défaut que releasePreview, sans refaire ses contrôles (release les refait).
      const chosen = tag ?? suggestVersionTag(await container.versions.repoName(repo, ws), (await container.versions.get(repo, id)).title)
      return jsonToolResult(await container.versions.release(repo, id, chosen, ws))
    },
  )
}
