import { z } from 'zod'
import type { Dashboard, QueryColumnDef, QueryParameterDef, SavedQuery, ScriptClientInfo, ScriptRunRequest, ScriptRunResult } from '@polenta/types'
import { COMPUTED_COLUMN_CATEGORIES, COMPUTED_COLUMN_TYPES, QUERY_PARAMETER_KINDS, validateColumnDecl, validateParameterDecls } from '@polenta/types'
import type { McpContainer } from '../container'
import { errorToolResult } from '../mcp-types'
import { resolveWorkspaceRepoPaths } from '../../main/services/workspace-repos.util'
import { isReadonlyBranch } from '../../main/services/readonly-branch.util'
import { isPrivateScopeId } from '../../main/services/id-scope.util'
import { formatCounterId, peekNextCounterId } from '../../main/services/id-counter.util'
import type { SuiviErrorCode } from '../../main/services/suivi-validation.util'

/**
 * Helpers communs aux tools de la vue Suivi (GH18 — specs/GH18-design.md §3–4).
 */

/**
 * Sentinelle passée aux services quand `--user` est absent. Le caractère nul rend le
 * chemin `.{username}.pref` invalide : la lecture échoue → `{}` (aucun objet privé) et une
 * écriture lèverait — aucun `.pref` parasite ne peut être créé. Les tools refusent de toute
 * façon en amont toute opération privée sans utilisateur (`PRIVATE_SCOPE_UNAVAILABLE`).
 */
export const NO_USER = '\u0000no-user'

export function resolveUser(c: McpContainer): { username: string; hasUser: boolean } {
  return c.user ? { username: c.user, hasUser: true } : { username: NO_USER, hasUser: false }
}

/** Erreur de validation attendue : `[CODE] raison` (SPEC-MCP-SERVER §6). */
export function suiviError(code: SuiviErrorCode, reason: string): ReturnType<typeof errorToolResult> {
  return errorToolResult(`[${code}] ${reason}`)
}

export const PRIVATE_SCOPE_REASON =
  'Scope privé indisponible : serveur MCP lancé sans --user (ou POLENTA_USER).'

/** `READONLY_BRANCH` si la branche courante est en lecture seule, sinon null. */
export async function assertWritableBranch(c: McpContainer): Promise<ReturnType<typeof errorToolResult> | null> {
  const branch = await c.git.currentBranch(c.repoPath).catch(() => '')
  if (!isReadonlyBranch(branch)) return null
  return suiviError('READONLY_BRANCH', `Branche en lecture seule (${branch || 'HEAD détaché'}) : aucune écriture autorisée.`)
}

/**
 * Invalide les index exigences/tests de tous les repos du périmètre : ce process n'a pas
 * de RepoWatcherService, une requête exécutée sur l'index en cache ignorerait les objets
 * créés/modifiés par l'app depuis sa construction.
 */
export async function freshenIndexes(c: McpContainer): Promise<void> {
  const repoPaths = await resolveWorkspaceRepoPaths(c.workspaceTree, c.repoPath, c.workspaceDir)
  for (const p of repoPaths) {
    c.reqIndex.invalidate(p)
    c.testsIndex.invalidate(p)
  }
}

/** Informations « client » des exécutions MCP : langue française, fuseau de la machine. */
export function mcpClient(locale: 'fr' | 'en' = 'fr'): ScriptClientInfo {
  return { locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
}

/** Exécute (requête / widget enregistré, ou code fourni) après avoir rafraîchi les index. */
export async function runScript(c: McpContainer, req: ScriptRunRequest): Promise<ScriptRunResult> {
  await freshenIndexes(c)
  c.dashboardLibrary.invalidate(c.repoPath)
  const { username } = resolveUser(c)
  return c.suivi.run(c.repoPath, c.workspaceDir, username, req, mcpClient())
}

/** Aperçu d'un résultat : colonnes, total, premières lignes. */
export function preview(result: ScriptRunResult, size = 5) {
  return result.ok
    ? { columns: result.columns, total: result.total, sample: result.rows.slice(0, size) }
    : { error: result.error }
}

const SHARED_QUERY_ID = /^QUERY-\d+$/
const SHARED_DASHBOARD_ID = /^DASHBOARD-\d+$/

/** Requête visible par cet appel : un id privé sans `--user` n'est jamais résolu, et un id
 *  partagé hors format `QUERY-NNNN` non plus (il servirait de chemin de fichier). */
export async function findVisibleQuery(c: McpContainer, id: string): Promise<SavedQuery | null> {
  const { username, hasUser } = resolveUser(c)
  if (isPrivateScopeId(id) ? !hasUser : !SHARED_QUERY_ID.test(id)) return null
  return c.savedQueries.findOne(c.repoPath, username, id)
}

/** Dashboard visible par cet appel — mêmes règles que `findVisibleQuery` (`DASHBOARD-NNNN`). */
export async function findVisibleDashboard(c: McpContainer, id: string): Promise<Dashboard | null> {
  const { username, hasUser } = resolveUser(c)
  if (isPrivateScopeId(id) ? !hasUser : !SHARED_DASHBOARD_ID.test(id)) return null
  return c.dashboards.get(c.repoPath, username, id)
}

/** Id qu'aurait un objet partagé créé maintenant — même calcul que `nextCounterId`
 *  (fichiers + pierres tombales, GH20), en lecture seule. */
export async function peekSharedId(c: McpContainer, key: 'QUERY' | 'DASHBOARD'): Promise<string> {
  const dir = key === 'QUERY' ? 'queries' : 'dashboards'
  return formatCounterId(key, await peekNextCounterId(c.git, c.repoPath, key, dir))
}

// ─── Paramètres choisis à l'affichage (GH93) ─────────────────────────────────

const labelSchema = z.union([z.string(), z.object({ fr: z.string(), en: z.string() })])
export const paramValueSchema = z.union([
  z.string(),
  z.object({ from: z.string().nullable().optional(), to: z.string().nullable().optional() }),
  z.null(),
])

/** Déclaration de paramètres d'une requête (validée ensuite par `validateParameterDecls`). */
export const parametersSchema = z.array(z.object({
  name: z.string().describe('clé dans polenta.params (lettre puis lettres, chiffres, _)'),
  kind: z.enum(QUERY_PARAMETER_KINDS as unknown as [string, ...string[]])
    .describe('campaign | component | objectType | enum | text | period'),
  label: labelSchema.describe('libellé du sélecteur ({ fr, en } ou un seul texte)'),
  values: z.array(z.object({ value: z.string(), label: labelSchema.optional() })).optional().describe('enum seulement'),
  default: paramValueSchema.optional(),
  required: z.boolean().optional().describe('vrai : pas de choix « Tous / Toutes »'),
})).describe('paramètres choisis à l\'affichage (barre du dashboard) : valeurs reçues dans polenta.params')

/** GH70 — déclaration de colonne calculée de la Vue Système (requête partagée). */
export const columnSchema = z.object({
  label: labelSchema.describe('libellé de la colonne ({ fr, en } ou un seul texte)'),
  appliesTo: z.object({
    categories: z.array(z.enum(COMPUTED_COLUMN_CATEGORIES as unknown as [string, ...string[]])).optional().default([]),
    objectTypes: z.array(z.string()).optional().default([]).describe('types précis <nœud>::<type>'),
  }).describe('colonne proposée pour un type si sa catégorie OU son objectTypeRef figure ici'),
  type: z.enum(COMPUTED_COLUMN_TYPES as unknown as [string, ...string[]]).describe('type de champ qui gouverne le rendu de la cellule'),
  values: z.array(z.string()).optional().describe('enum / multi_enum : valeurs possibles'),
  idColumn: z.string().nullable().optional().describe("colonne du résultat qui porte l'ID de l'élément (défaut id ; null = défaut)"),
  valueColumn: z.string().nullable().optional().describe('colonne du résultat qui porte la valeur (défaut value ; null = défaut)'),
  tooltipColumn: z.string().nullable().optional().describe("colonne du résultat qui porte l'infobulle (défaut tooltip ; null = défaut)"),
  splitColumn: z.string().nullable().optional().describe(
    'colonne éclatée (GH126) : une sous-colonne par valeur distincte de cette colonne du résultat (ex. campaignId), 50 au maximum ; null = colonne simple',
  ),
  splitLabelColumn: z.string().nullable().optional().describe('libellé de chaque sous-colonne (ex. campaignTitle ; défaut : la valeur) ; exige splitColumn'),
}).describe(
  'colonne calculée de la Vue Système (requête partagée seulement) : le script renvoie une ligne par élément ' +
  '(colonnes idColumn / valueColumn / tooltipColumn, défaut id / value / tooltip ; _ids = cible ouverte au double-clic) ; ' +
  'avec splitColumn, une ligne par (élément, sous-colonne)',
)

/** Déclaration de colonne validée (`null` = aucune), ou l'erreur `COLUMN_INVALID` à renvoyer. */
export function checkColumn(raw: unknown): { column: QueryColumnDef | null } | { error: ReturnType<typeof suiviError> } {
  const { decl, errors } = validateColumnDecl(raw)
  return errors.length ? { error: suiviError('COLUMN_INVALID', errors.join(' ; ')) } : { column: decl }
}

/** Valeurs des paramètres pour une exécution (clés = noms déclarés). */
export const paramsSchema = z.record(paramValueSchema)
  .describe('valeurs des paramètres déclarés (période : { from, to } en AAAA-MM-JJ) ; absent → défaut de la déclaration')

/** Déclaration validée, ou l'erreur `PARAMS_INVALID` à renvoyer. */
export function checkParameters(raw: unknown): { decls: QueryParameterDef[] } | { error: ReturnType<typeof suiviError> } {
  const { decls, errors } = validateParameterDecls(raw)
  return errors.length ? { error: suiviError('PARAMS_INVALID', errors.join(' ; ')) } : { decls }
}
