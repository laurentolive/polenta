import { z } from 'zod'
import type { ObjectCategory, ObjectHistory, ProjectSchema, TransitionIssue } from '@polenta/types'
import { UpdateRequirementSchema, UpdateTestCaseSchema } from '@polenta/zod-schemas'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { RICHTEXT_COLORS_NOTE } from './richtext-colors-note'
import { planUpdate, type FieldChange, type UpdatableObject } from '../../main/services/update-validation.util'
import { canonicalMultiEnumFields } from '../../main/services/field-values.util'
import { findObjectTypeDef } from '../../main/services/schema-lookup.util'
import { mergeFields } from '../../main/services/field-merge.util'
import { readOwnedTypeDef } from '../../main/services/field-write.util'
import { findOwnerScope, isScopeReadonly, scoped, workspaceScopes } from './workspace-scope'

/**
 * Tools de modification d'objets existants (GH150 — specs/GH150-design.md) :
 * `update_requirements` / `update_tests`. Même contrat que `bulk_import_*` : `dryRun` par défaut
 * `true` (aperçu avant/après, aucune écriture), sinon écriture EN SÉRIE, best-effort.
 *
 * Les écritures passent par les services de l'appli (`history` avec `source: mcp`, version,
 * revalidation T172). Une entrée qui change contenu et statut écrit d'abord le contenu
 * (`update`), puis le statut (exigences : `transition()` ; tests : `update({ status })`) — décision
 * 1 de specs/GH150.md. GH163 — `modificationComment` est posé sur les entrées d'historique créées ;
 * sans changement de champ suivi, il n'est conservé nulle part : avertissement sur l'entrée.
 * GH200 — le contenu d'un élément approuvé est verrouillé : une entrée qui le fait aussi quitter
 * l'approbation écrit d'abord le statut (réouverture, version + 1), puis le contenu.
 */

// `fields` : `z.unknown()` accepte `null`, qui retire le champ (fusion `mergeFields`).
const requirementEntrySchema = UpdateRequirementSchema
  .extend({ id: z.string().min(1), status: z.string().min(1).optional() })
  .strict()

const testEntrySchema = UpdateTestCaseSchema
  .omit({ objectTypeRef: true })
  .extend({ id: z.string().min(1) })
  .strict()

const TEST_STRUCTURE_KEYS = ['preconditions', 'postconditions', 'steps', 'equipment'] as const

interface UpdateToolResult {
  dryRun: boolean
  summary: { total: number; ok: number; failed: number }
  /** `dryRun: false` uniquement — objets réécrits (ou inchangés : `changed: false`). */
  updated: Array<{ index: number; id: string; version?: number; changed: boolean; warning?: string; transitionWarnings?: TransitionIssue[] }>
  /** `dryRun: true` uniquement — modifications prévues, par champ. GH206 : notifications du passage de statut. */
  preview: Array<{ index: number; id: string; changes: Record<string, FieldChange>; transitionWarnings?: TransitionIssue[] }>
  errors: Array<{ index: number; id: string; reason: string; field?: string; partial?: boolean }>
}

type Written = { version?: number; history?: ObjectHistory }

/** GH447 — `c` : conteneur du repo qui porte l'objet (racine ou composant en repo séparé, `scoped`). */
interface UpdateTarget<TEntry> {
  category: Extract<ObjectCategory, 'requirement' | 'test'>
  extraKeys: readonly string[]
  find: (c: McpContainer, id: string) => Promise<UpdatableObject & Written>
  /** Écrit le contenu (tout sauf `status`) ; renvoie l'objet écrit. */
  writeContent: (c: McpContainer, entry: TEntry) => Promise<Written>
  writeStatus: (c: McpContainer, id: string, status: string, comment?: string) => Promise<Written>
}

/** Nombre total d'entrées d'historique (tous champs suivis). */
const historySize = (o: Written | undefined) => Object.values(o?.history ?? {}).reduce((n, l) => n + l.length, 0)

const NO_TRACKED_CHANGE = "modificationComment non conservé : aucun champ suivi (statut, champ trackHistory) n'a changé"


async function runUpdate<TEntry extends { id: string; status?: string; modificationComment?: string; fields?: Record<string, unknown> }>(
  container: McpContainer,
  entries: TEntry[],
  dryRun: boolean,
  target: UpdateTarget<TEntry>,
): Promise<UpdateToolResult> {
  const result: UpdateToolResult = {
    dryRun, summary: { total: entries.length, ok: 0, failed: 0 }, updated: [], preview: [], errors: [],
  }
  // GH447 — chaque objet se lit et s'écrit dans le repo qui le porte, avec le schéma de ce repo.
  const scopes = await workspaceScopes(container)
  const schemas = new Map<string, Promise<ProjectSchema>>()
  const readonly = new Map<string, Promise<boolean>>()

  // Série, jamais Promise.all : deux entrées sur le même ID s'appliquent dans l'ordre.
  for (const [index, input] of entries.entries()) {
    let entry = input
    const scope = await findOwnerScope(container, scopes, target.category, entry.id)
    const c = scope ? scoped(container, scope) : container
    let existing: UpdatableObject & Written
    try {
      existing = await target.find(c, entry.id)
    } catch {
      result.errors.push({ index, id: entry.id, reason: `objet introuvable : ${entry.id}` })
      continue
    }
    if (scope && !readonly.has(scope.repoPath)) readonly.set(scope.repoPath, isScopeReadonly(container, scope))
    if (scope && await readonly.get(scope.repoPath)) {
      result.errors.push({ index, id: entry.id, reason: `composant '${scope.component}' en lecture seule — écriture refusée` })
      continue
    }
    if (!schemas.has(c.repoPath)) schemas.set(c.repoPath, c.schema.get(c.repoPath))
    const schema = await schemas.get(c.repoPath)!
    // GH384 — `multi_enum` en liste réécrit au format de l'application (« a, b »).
    const typeDef = findObjectTypeDef(schema, existing.objectTypeRef, target.category)
    const canonical = canonicalMultiEnumFields(typeDef === 'unresolvable' ? null : typeDef, entry.fields)
    if (canonical !== entry.fields) entry = { ...entry, fields: canonical }
    const plan = planUpdate(schema, target.category, existing, entry as never, target.extraKeys)
    if (!plan.ok) {
      for (const e of plan.errors) result.errors.push({ index, id: entry.id, reason: e.reason, ...(e.field && { field: e.field }) })
      continue
    }
    // GH206 — contraintes de transition sur l'état prévu, avant toute écriture : `dryRun` et écriture réelle
    // donnent le même résultat, et un statut refusé n'écrit pas le contenu (pas d'écriture partielle).
    let transitionWarnings: TransitionIssue[] = []
    if (plan.changes.status) {
      const check = await transitionCheck(c, existing, entry)
      if (check.blocked) {
        result.errors.push({ index, id: entry.id, reason: `TRANSITION_BLOCKED: ${check.issues.map(i => i.message).join(' ; ')}` })
        continue
      }
      transitionWarnings = check.issues
    }
    const warned = transitionWarnings.length > 0 ? { transitionWarnings } : {}
    if (dryRun) {
      result.preview.push({ index, id: entry.id, changes: plan.changes, ...warned })
      continue
    }

    const changedKeys = Object.keys(plan.changes)
    if (changedKeys.length === 0) {
      result.updated.push({ index, id: entry.id, version: existing.version, changed: false })
      continue
    }
    let written: Written | undefined
    try {
      const hasContent = changedKeys.some(k => k !== 'status')
      const reopening = !!plan.changes.status && leavesApproval(schema, target.category, existing, entry.status!)
      // GH200 — réouverture d'abord : le contenu d'un élément approuvé est verrouillé.
      if (reopening) written = await target.writeStatus(c, entry.id, entry.status!, entry.modificationComment)
      if (hasContent) written = await target.writeContent(c, entry)
      if (plan.changes.status && !reopening) written = await target.writeStatus(c, entry.id, entry.status!, entry.modificationComment)
      const commentLost = !!entry.modificationComment?.trim() && historySize(written) <= historySize(existing)
      result.updated.push({
        index, id: entry.id, version: written?.version, changed: true, ...(commentLost && { warning: NO_TRACKED_CHANGE }), ...warned,
      })
    } catch (e) {
      result.errors.push({
        index, id: entry.id, reason: e instanceof Error ? e.message : String(e),
        // Contenu déjà écrit, statut en échec : l'entrée est partiellement appliquée.
        ...(written && { partial: true }),
      })
    }
  }

  result.summary.ok = dryRun ? result.preview.length : result.updated.length
  // GH384 — plusieurs erreurs possibles par entrée : `failed` compte les entrées.
  result.summary.failed = new Set(result.errors.map(e => e.index)).size
  result.errors.sort((a, b) => a.index - b.index)
  return result
}

/** GH206 — contrôle du passage de statut d'une entrée, sur l'état prévu (titre, champs fusionnés, statut). */
async function transitionCheck(
  container: McpContainer,
  existing: UpdatableObject & { id?: string },
  entry: { id: string; status?: string; title?: string; fields?: Record<string, unknown> },
) {
  const { repoPath, workspaceDir } = container
  const owner = (await container.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
  const typeDef = await readOwnedTypeDef(container.git, repoPath, existing.objectTypeRef, owner)
  const planned = {
    id: entry.id,
    title: entry.title ?? existing.title,
    status: entry.status ?? existing.status,
    fields: mergeFields(existing.fields, entry.fields),
  }
  return container.transitionGuard.check(repoPath, typeDef, existing, planned, workspaceDir)
}

/** GH200 — le passage à `status` fait-il quitter un statut `isApproval` ? */
function leavesApproval(schema: ProjectSchema, category: ObjectCategory, existing: UpdatableObject, status: string): boolean {
  const typeDef = findObjectTypeDef(schema, existing.objectTypeRef, category)
  const statuses = typeDef && typeDef !== 'unresolvable' ? typeDef.statuses ?? [] : []
  const isApproval = (s: string) => !!statuses.find(x => x.name === s)?.isApproval
  return isApproval(existing.status) && !isApproval(status)
}

export function registerUpdateTools(server: McpServer, container: McpContainer): void {
  const { workspaceDir } = container

  server.registerTool(
    'update_requirements',
    {
      title: 'Update requirements',
      description:
        "Modifie des exigences existantes, par ID (repo ouvert ou composant du workspace : l'exigence est " +
        "modifiée dans le repo qui la porte, selon le schéma de ce repo) : title, status, fields (fusion partielle ; une clé " +
        "à null retire le champ). dryRun (défaut true) : valide chaque entrée (statut connu du type, " +
        "champs déclarés, valeurs d'enum / multi_enum, number, boolean et date bien formés, champs required " +
        "non vidés, syntaxe EARS des champs modifiés) " +
        "et retourne l'avant/après par champ SANS RIEN ÉCRIRE. dryRun: false : écrit en série, " +
        "best-effort, par les règles de l'appli (historique, version, revalidation des éléments liés " +
        "en sortie d'approbation). modificationComment (facultatif) : conservé sur les entrées d'historique " +
        "créées par l'entrée (changement de statut ou de champ suivi), sinon avertissement. Ne jamais " +
        "réécrire un YAML d'exigence à la main." + RICHTEXT_COLORS_NOTE,
      inputSchema: { entries: z.array(requirementEntrySchema), dryRun: z.boolean().optional().default(true) },
    },
    async ({ entries, dryRun }) => jsonToolResult(await runUpdate(container, entries, dryRun, {
      category: 'requirement',
      extraKeys: [],
      find: (c, id) => c.requirements.findOne(c.repoPath, id),
      writeContent: (c, { id, title, fields, modificationComment }) =>
        c.requirements.update(c.repoPath, id, { title, fields, modificationComment }, workspaceDir, { removeNullFields: true }),
      writeStatus: (c, id, status, comment) =>
        c.requirements.transition(c.repoPath, id, { toStatus: status, comment }, workspaceDir),
    })),
  )

  server.registerTool(
    'update_tests',
    {
      title: 'Update tests',
      description:
        "Modifie des cas de test existants, par ID. Mêmes règles que update_requirements, plus " +
        "preconditions, postconditions, steps et equipment (remplacés en bloc).",
      inputSchema: { entries: z.array(testEntrySchema), dryRun: z.boolean().optional().default(true) },
    },
    async ({ entries, dryRun }) => jsonToolResult(await runUpdate(container, entries, dryRun, {
      category: 'test',
      extraKeys: TEST_STRUCTURE_KEYS,
      find: (c, id) => c.tests.findOne(c.repoPath, id),
      writeContent: (c, { id, title, fields, preconditions, postconditions, steps, equipment, modificationComment }) =>
        c.tests.update(
          c.repoPath, id, { title, fields, preconditions, postconditions, steps, equipment, modificationComment }, workspaceDir,
          { removeNullFields: true },
        ),
      writeStatus: (c, id, status, comment) =>
        c.tests.update(c.repoPath, id, { status, modificationComment: comment }, workspaceDir),
    })),
  )
}
