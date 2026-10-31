import { z } from 'zod'
import type { ObjectCategory, ObjectHistory, ProjectSchema } from '@polenta/types'
import { UpdateRequirementSchema, UpdateTestCaseSchema } from '@polenta/zod-schemas'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { planUpdate, type FieldChange, type UpdatableObject } from '../../main/services/update-validation.util'
import { findObjectTypeDef } from '../../main/services/schema-lookup.util'

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
 * l'approbation écrit d'abord le statut (réouverture, assignée à `changesetId` ou au seul changeset
 * ouvert), puis le contenu. Une réouverture non assignée est listée dans `unassigned`.
 */

// `fields` : `z.unknown()` accepte `null`, qui retire le champ (fusion `mergeFields`).
const requirementEntrySchema = UpdateRequirementSchema
  .extend({ id: z.string().min(1), status: z.string().min(1).optional(), changesetId: z.string().min(1).optional() })
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
  updated: Array<{ index: number; id: string; version?: number; changed: boolean; warning?: string }>
  /** `dryRun: true` uniquement — modifications prévues, par champ. */
  preview: Array<{ index: number; id: string; changes: Record<string, FieldChange> }>
  errors: Array<{ index: number; id: string; reason: string; field?: string; partial?: boolean }>
  /** GH200 — éléments rouverts sans changeset (règle active) : dans le backlog. */
  unassigned: string[]
}

type Written = { version?: number; history?: ObjectHistory }

interface UpdateTarget<TEntry> {
  category: ObjectCategory
  extraKeys: readonly string[]
  find: (id: string) => Promise<UpdatableObject & Written>
  /** Écrit le contenu (tout sauf `status`) ; renvoie l'objet écrit. */
  writeContent: (entry: TEntry) => Promise<Written>
  writeStatus: (id: string, status: string, comment?: string, changesetId?: string) => Promise<Written>
}

/** Nombre total d'entrées d'historique (tous champs suivis). */
const historySize = (o: Written | undefined) => Object.values(o?.history ?? {}).reduce((n, l) => n + l.length, 0)

const NO_TRACKED_CHANGE = "modificationComment non conservé : aucun champ suivi (statut, champ trackHistory) n'a changé"


async function runUpdate<TEntry extends { id: string; status?: string; modificationComment?: string; changesetId?: string }>(
  container: McpContainer,
  entries: TEntry[],
  dryRun: boolean,
  target: UpdateTarget<TEntry>,
): Promise<UpdateToolResult> {
  const schema = await container.schema.get(container.repoPath)
  const result: UpdateToolResult = {
    dryRun, summary: { total: entries.length, ok: 0, failed: 0 }, updated: [], preview: [], errors: [], unassigned: [],
  }

  // Série, jamais Promise.all : deux entrées sur le même ID s'appliquent dans l'ordre.
  for (const [index, entry] of entries.entries()) {
    let existing: UpdatableObject & Written
    try {
      existing = await target.find(entry.id)
    } catch {
      result.errors.push({ index, id: entry.id, reason: `objet introuvable : ${entry.id}` })
      continue
    }
    const plan = planUpdate(schema, target.category, existing, entry as never, target.extraKeys)
    if (!plan.ok) {
      result.errors.push({ index, id: entry.id, reason: plan.reason, ...(plan.field && { field: plan.field }) })
      continue
    }
    if (dryRun) {
      result.preview.push({ index, id: entry.id, changes: plan.changes })
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
      if (reopening) written = await target.writeStatus(entry.id, entry.status!, entry.modificationComment, entry.changesetId)
      if (hasContent) written = await target.writeContent(entry)
      if (plan.changes.status && !reopening) written = await target.writeStatus(entry.id, entry.status!, entry.modificationComment, entry.changesetId)
      if (reopening) {
        const check = await container.changeTracking.check(container.repoPath, { id: entry.id, objectTypeRef: existing.objectTypeRef }, 'reopen', container.workspaceDir)
        if (check.tracking && !check.assignedTo) result.unassigned.push(entry.id)
      }
      const commentLost = !!entry.modificationComment?.trim() && historySize(written) <= historySize(existing)
      result.updated.push({
        index, id: entry.id, version: written?.version, changed: true, ...(commentLost && { warning: NO_TRACKED_CHANGE }),
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
  result.summary.failed = result.errors.length
  result.errors.sort((a, b) => a.index - b.index)
  return result
}

/** GH200 — le passage à `status` fait-il quitter un statut `isApproval` ? */
function leavesApproval(schema: ProjectSchema, category: ObjectCategory, existing: UpdatableObject, status: string): boolean {
  const typeDef = findObjectTypeDef(schema, existing.objectTypeRef, category)
  const statuses = typeDef && typeDef !== 'unresolvable' ? typeDef.statuses ?? [] : []
  const isApproval = (s: string) => !!statuses.find(x => x.name === s)?.isApproval
  return isApproval(existing.status) && !isApproval(status)
}

export function registerUpdateTools(server: McpServer, container: McpContainer): void {
  const { repoPath, workspaceDir } = container

  server.registerTool(
    'update_requirements',
    {
      title: 'Update requirements',
      description:
        "Modifie des exigences existantes, par ID : title, status, fields (fusion partielle ; une clé " +
        "à null retire le champ). dryRun (défaut true) : valide chaque entrée (statut connu du type, " +
        "champs déclarés, valeurs d'enum, champs required non vidés, syntaxe EARS des champs modifiés) " +
        "et retourne l'avant/après par champ SANS RIEN ÉCRIRE. dryRun: false : écrit en série, " +
        "best-effort, par les règles de l'appli (historique, version, revalidation des éléments liés " +
        "en sortie d'approbation). modificationComment (facultatif) : conservé sur les entrées d'historique " +
        "créées par l'entrée (changement de statut ou de champ suivi), sinon avertissement. Ne jamais " +
        "réécrire un YAML d'exigence à la main.",
      inputSchema: { entries: z.array(requirementEntrySchema), dryRun: z.boolean().optional().default(true) },
    },
    async ({ entries, dryRun }) => jsonToolResult(await runUpdate(container, entries, dryRun, {
      category: 'requirement',
      extraKeys: [],
      find: id => container.requirements.findOne(repoPath, id),
      writeContent: ({ id, title, fields, modificationComment }) =>
        container.requirements.update(repoPath, id, { title, fields, modificationComment }, workspaceDir, { removeNullFields: true }),
      writeStatus: (id, status, comment, changesetId) =>
        container.requirements.transition(repoPath, id, { toStatus: status, comment, changesetId }, workspaceDir),
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
      find: id => container.tests.findOne(repoPath, id),
      writeContent: ({ id, title, fields, preconditions, postconditions, steps, equipment, modificationComment }) =>
        container.tests.update(
          repoPath, id, { title, fields, preconditions, postconditions, steps, equipment, modificationComment }, workspaceDir,
          { removeNullFields: true },
        ),
      writeStatus: (id, status, comment, changesetId) =>
        container.tests.update(repoPath, id, { status, modificationComment: comment, changesetId }, workspaceDir),
    })),
  )
}
