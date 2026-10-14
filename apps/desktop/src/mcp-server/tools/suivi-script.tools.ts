import * as path from 'path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { GRAPH_CONTRACT_VERSION } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult, LIST_RESULT_LIMIT } from '../mcp-types'
import { contentHash, LIBRARY_DIR } from '../../main/services/dashboard-library.service'
import { DEFAULT_SANDBOX_LIMITS } from '../../main/services/script-limits'
import { assertWritableBranch, freshenIndexes, suiviError } from './suivi-common'

/**
 * Tools GH74 (sprint 1) — moteur de scripts de la vue Suivi : contrat de données, exécution d'un
 * script sur les données réelles, bibliothèque projet (`dashboards/lib/`). Specs/GH74.md §10.
 */

/** Conventions du contrat, en plus des types (`polenta.d.ts`). */
const CONVENTIONS = [
  'Script de données : module ES, `export default function (data, polenta) { return rows }`, synchrone. `data` (PolentaGraph) est en lecture seule.',
  'Transformation de widget : `export default function (rows, polenta) { return rows2 }` — reçoit les lignes du script de données.',
  'Première ligne facultative `// @polenta contract 1` (version majeure du contrat visée).',
  'Ligne = objet plat de valeurs scalaires (chaîne, nombre, booléen, null) + `_ids` facultatif : identifiants des objets d\'origine (drill-down). Entrée de campagne : `<campagne>/<entrée>`.',
  'Agréger en JS (script ou transformation), jamais dans la spec Vega-Lite : `aggregate` perd `_ids`. Faire l\'union des `_ids` des lignes regroupées.',
  'Séries longues : omettre `_ids` et les renvoyer seulement quand `polenta.drill` est renseigné (colonnes de la ligne cliquée).',
  'Pas de `Intl` ; l\'heure locale de `Date` est celle du serveur : découper par jour avec `lib/time.js` (`dayOf`, `dayEnd`), qui lit `polenta.timezoneOffsets`. Utiliser `polenta.now` / `polenta.today` plutôt que `Date.now()`.',
  'Imports : `lib/<module>.js` (dashboards/lib/ du repo ouvert), `<composant>::lib/<module>.js` (repo composant), chemins relatifs entre modules de lib/. Rien d\'autre (pas de fs, réseau, npm, timers, console).',
  'Un type d\'objet se désigne par (repo, objectTypeRef) : `root::…` n\'est pas unique entre repos.',
  'Spec Vega-Lite : `"data": { "name": "rows" }` ; couleurs par jetons `"var(--status-success-solid)"`, `"var(--chart-series-1)"`…',
  'Conventions de l\'hôte dans `usermeta.polenta` : `view: "kpi" | "table"` (rendu natif, `field` / `suffix` / `columns`) ; `seriesColors: { field, color, order? }` — l\'échelle de couleur de `field` est construite depuis les lignes (couleur = colonne `color`, jeton `var(--…)` accepté ; ordre = colonne numérique `order`), pour des séries inconnues à l\'écriture de la spec.',
  `Limites : ${DEFAULT_SANDBOX_LIMITS.timeMs / 1000} s par exécution (script + transformation), ${DEFAULT_SANDBOX_LIMITS.memoryBytes / 1048576} Mo de mémoire.`,
]

const testScriptInput = {
  script: z.string().min(1).describe('script de données (module ES)'),
  transform: z.string().optional().describe('transformation de widget appliquée aux lignes du script'),
  drill: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
    .describe('simule un clic sur une ligne sans `_ids` (polenta.drill)'),
  limit: z.number().int().min(1).max(LIST_RESULT_LIMIT).optional().default(LIST_RESULT_LIMIT),
  locale: z.enum(['fr', 'en']).optional().default('fr'),
  timezone: z.string().optional().describe('fuseau IANA (défaut : celui de la machine)'),
}

const libraryPathInput = {
  path: z.string().min(1).describe('chemin du module dans dashboards/lib/ (ex. `campaign.js`), ou `<composant>::lib/x.js` en lecture'),
}

const writeLibraryInput = {
  path: z.string().min(1).describe('chemin du module dans dashboards/lib/ du repo ouvert (ex. `mesures.js`)'),
  content: z.string(),
  dryRun: z.boolean().optional().default(true),
}

/** Chemin relatif à `dashboards/lib/` validé (fichier `.js`, sans sortie du dossier), sinon null. */
export function libraryRelPath(input: string): string | null {
  const rel = input.replace(/\\/g, '/').replace(/^(dashboards\/)?lib\//, '')
  if (!rel.endsWith('.js') || rel.startsWith('/') || rel.includes('::')) return null
  const normalized = path.posix.normalize(rel)
  if (normalized !== rel || normalized.startsWith('..') || normalized.split('/').some((s) => s === '' || s.startsWith('.'))) return null
  return normalized
}

export function registerSuiviScriptTools(server: McpServer, container: McpContainer): void {
  const c = container

  server.registerTool(
    'get_data_contract',
    {
      title: 'Get data contract',
      description:
        'Contrat de données des scripts de la vue Suivi (GH74) : types TypeScript du graphe (polenta.d.ts — ' +
        'exigences, tests, liens, campagnes → entrées, exécutions, historique, schéma) et conventions ' +
        '(_ids, agrégation, drill-down, fuseau, imports). À lire avant d\'écrire un script ou une transformation.',
      inputSchema: {},
    },
    async () => jsonToolResult({
      contractVersion: GRAPH_CONTRACT_VERSION,
      conventions: CONVENTIONS,
      types: c.dashboardLibrary.readShippedFile('polenta.d.ts'),
    }),
  )

  server.registerTool(
    'test_script',
    {
      title: 'Test script',
      description:
        'Exécute un script de données (et une transformation facultative) dans le bac à sable, sur les données ' +
        'réelles du projet (repo ouvert + composants), sans rien enregistrer. Retourne les colonnes, les lignes ' +
        '(au plus `limit`) et le total, ou l\'erreur avec fichier et ligne. Cf. get_data_contract.',
      inputSchema: testScriptInput,
    },
    async ({ script, transform, drill, limit, locale, timezone }) => {
      await freshenIndexes(c)
      c.dashboardLibrary.invalidate(c.repoPath)
      const result = await c.scriptEngine.run(c.repoPath, c.workspaceDir, { script, transform, transformFile: 'transform.js', drill: drill ?? null, limit }, {
        locale,
        timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (!result.ok) return suiviError('SCRIPT_ERROR', JSON.stringify(result.error))
      return jsonToolResult(result)
    },
  )

  server.registerTool(
    'list_library',
    {
      title: 'List library modules',
      description:
        'Modules de la bibliothèque projet importables par les scripts : `lib/x.js` (dashboards/lib/ du repo ' +
        'ouvert) et `<composant>::lib/x.js`. Pour chacun : taille, et version livrée par Polenta si le fichier ' +
        'est intact (`modified: true` s\'il a été modifié par le projet).',
      inputSchema: {},
    },
    async () => {
      c.dashboardLibrary.invalidate(c.repoPath)
      const { modules } = await c.dashboardLibrary.load(c.repoPath, c.workspaceDir)
      const manifest = c.dashboardLibrary.readShippedManifest()
      const list = Object.keys(modules).sort().map((key) => {
        const shipped = manifest.files.find((f) => `lib/${f.path}` === key.replace(/^[^:]+::/, ''))
        const hash = contentHash(modules[key])
        const version = shipped?.versions.find((v) => v.hash === hash)
        return {
          key,
          size: modules[key].length,
          ...(shipped ? { shippedId: shipped.id, shippedVersion: version?.version ?? null, modified: !version } : {}),
        }
      })
      return jsonToolResult({ modules: list })
    },
  )

  server.registerTool(
    'read_library_module',
    {
      title: 'Read library module',
      description: 'Contenu d\'un module de la bibliothèque projet (`campaign.js`, `lib/campaign.js` ou `<composant>::lib/x.js`).',
      inputSchema: libraryPathInput,
    },
    async ({ path: p }) => {
      c.dashboardLibrary.invalidate(c.repoPath)
      const { modules } = await c.dashboardLibrary.load(c.repoPath, c.workspaceDir)
      const key = p.includes('::') ? p : (() => { const rel = libraryRelPath(p); return rel ? `lib/${rel}` : null })()
      if (!key) return suiviError('LIBRARY_PATH_INVALID', `Chemin invalide : ${p}.`)
      if (!(key in modules)) return suiviError('LIBRARY_MODULE_NOT_FOUND', `Module introuvable : ${key}.`)
      return jsonToolResult({ key, content: modules[key] })
    },
  )

  server.registerTool(
    'write_library_module',
    {
      title: 'Write library module',
      description:
        'Crée ou remplace un module de dashboards/lib/ du repo ouvert (pas d\'un composant). dryRun (défaut) : ' +
        'n\'écrit rien. Un module de départ livré par Polenta et modifié ici ne recevra plus de proposition de ' +
        'mise à jour. Vérifier ensuite avec test_script.',
      inputSchema: writeLibraryInput,
    },
    async ({ path: p, content, dryRun }) => {
      const rel = libraryRelPath(p)
      if (!rel) return suiviError('LIBRARY_PATH_INVALID', `Chemin invalide : ${p} (fichier .js de dashboards/lib/, sans « .. »).`)
      const repoRel = `${LIBRARY_DIR}/${rel}`
      if (dryRun) return jsonToolResult({ dryRun: true, path: repoRel, size: content.length })
      const readonly = await assertWritableBranch(c)
      if (readonly) return readonly
      await c.git.writeText(c.repoPath, repoRel, content)
      c.dashboardLibrary.invalidate(c.repoPath)
      return jsonToolResult({ written: repoRel, key: `lib/${rel}` })
    },
  )
}
