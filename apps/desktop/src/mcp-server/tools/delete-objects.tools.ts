import * as fsP from 'fs/promises'
import * as path from 'path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { deleteWithTombstone } from '../../main/services/id-counter.util'
import { withKeyLock } from '../../main/services/serialize-writes.util'
import { findObjectTypeDef, findOwningNode, findLocalNodeByRefPrefix } from '../../main/services/schema-lookup.util'
import { findOwnerScope, groupByScope, isScopeReadonly, scoped, workspaceScopes, type RepoScope } from './workspace-scope'

/**
 * GH384 — suppression d'exigences et de tests par ID (`delete_requirements` / `delete_tests`), pour
 * corriger un import (doublon, mauvais lot). L'application n'a pas de suppression d'un objet seul (un
 * objet devient `obsolete`) : ces outils sont réservés à un objet **inutilisé**, et refusent tout objet :
 *
 * - lié à un autre objet (liens de tous les repos du workspace — `delete_links` d'abord) ;
 * - test d'une campagne (`testCaseIds` ou exécution) ;
 * - inclus dans une version (`changes`) ou cité par une entrée de validation ;
 * - d'un nœud `readonly`.
 *
 * Suppression : pierre tombale d'abord (GH20, l'ID n'est jamais réattribué), puis le fichier, puis les
 * exécutions (`test-runs/<ID>`) ou acquittements d'impact (`impact-acks/<ID>`), comme
 * `SchemaDeleteService`. Le rangement en dossiers n'est pas réécrit : un objet disparu y est ignoré.
 */

type Category = 'requirement' | 'test'

interface DeleteError { index: number; id: string; code: 'OBJECT_NOT_FOUND' | 'OBJECT_IN_USE' | 'NODE_READONLY' | 'DELETE_FAILED'; reason: string }

const deleteInput = {
  ids: z.array(z.string().min(1)).min(1),
  dryRun: z.boolean().optional().default(true),
}

const DIRS: Record<Category, { dir: string; extra: string }> = {
  requirement: { dir: 'requirements', extra: 'impact-acks' },
  test: { dir: 'tests', extra: 'test-runs' },
}

async function runDelete(container: McpContainer, category: Category, ids: string[], dryRun: boolean): Promise<DeleteResult> {
  const { repoPath, workspaceDir } = container
  // Process sans watcher : un objet ou un usage créé par l'application depuis le dernier appel doit compter.
  container.reqIndex.invalidate(repoPath)
  container.testsIndex.invalidate(repoPath)
  const schema = await container.schema.get(repoPath)
  const [links, campaigns, versions, validations] = await Promise.all([
    container.workspaceLinks.listLinks(repoPath, workspaceDir, true),
    container.campaigns.list(repoPath),
    container.versions.list(repoPath),
    container.validations.list(repoPath),
  ])

  const errors: DeleteError[] = []
  const accepted: Array<{ index: number; id: string; title: string }> = []
  const seen = new Set<string>()
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      errors.push({ index, id, code: 'OBJECT_NOT_FOUND', reason: `${id} : déjà traité dans ce lot` })
      continue
    }
    seen.add(id)
    const obj = await (category === 'requirement' ? container.requirements.findOne(repoPath, id) : container.tests.findOne(repoPath, id))
      .catch(() => null)
    if (!obj) {
      errors.push({ index, id, code: 'OBJECT_NOT_FOUND', reason: `${category === 'requirement' ? 'exigence' : 'test'} introuvable : ${id}` })
      continue
    }
    const typeDef = findObjectTypeDef(schema, obj.objectTypeRef)
    const node = !typeDef || typeDef === 'unresolvable'
      ? findLocalNodeByRefPrefix(schema, obj.objectTypeRef)
      : findOwningNode(schema, obj.objectTypeRef, typeDef)
    if (node?.readonly) {
      errors.push({ index, id, code: 'NODE_READONLY', reason: `nœud '${node.name}' en lecture seule — suppression refusée` })
      continue
    }
    const uses: string[] = []
    const linkIds = links.filter(l => l.sourceId === id || l.targetId === id).map(l => l.id)
    if (linkIds.length) uses.push(`lien(s) ${linkIds.join(', ')} (delete_links d'abord)`)
    const inCampaigns = campaigns
      .filter(c => c.testCaseIds?.includes(id) || c.runs?.some(r => r.testCaseId === id))
      .map(c => c.id)
    if (inCampaigns.length) uses.push(`campagne(s) ${inCampaigns.join(', ')}`)
    const inVersions = versions.filter(v => v.changes?.some(c => c.id === id)).map(v => v.id)
    if (inVersions.length) uses.push(`version(s) ${inVersions.join(', ')}`)
    const inValidations = validations.filter(v => v.entries?.some(e => e.requirementId === id)).map(v => v.id)
    if (inValidations.length) uses.push(`validation(s) ${inValidations.join(', ')}`)
    if (uses.length) {
      errors.push({ index, id, code: 'OBJECT_IN_USE', reason: `${id} utilisé : ${uses.join(' ; ')}` })
      continue
    }
    accepted.push({ index, id, title: obj.title })
  }

  const summary = { total: ids.length, ok: accepted.length, failed: errors.length }
  if (dryRun) return { dryRun: true, summary, wouldDelete: accepted, deleted: [], errors }

  const { dir, extra } = DIRS[category]
  const deleted: string[] = []
  for (const { index, id } of accepted) {
    try {
      await withKeyLock(`${repoPath}::${dir}/${id}`, () => deleteWithTombstone(container.git, repoPath, `${dir}/${id}.yaml`, id))
      deleted.push(id)
      await fsP.rm(path.join(repoPath, extra, id), { recursive: true, force: true })
    } catch (e) {
      errors.push({ index, id, code: 'DELETE_FAILED', reason: e instanceof Error ? e.message : String(e) })
    }
  }
  container.reqIndex.invalidate(repoPath)
  container.testsIndex.invalidate(repoPath)
  errors.sort((a, b) => a.index - b.index)
  return { dryRun: false, summary: { total: ids.length, ok: deleted.length, failed: errors.length }, wouldDelete: [], deleted, errors }
}

interface DeleteResult {
  dryRun: boolean
  summary: { total: number; ok: number; failed: number }
  wouldDelete: Array<{ index: number; id: string; title: string }>
  deleted: string[]
  errors: DeleteError[]
}

/**
 * GH447 — chaque ID est supprimé dans le repo qui le porte (racine ou composant en repo séparé du
 * workspace) : campagnes, versions et validations de ce repo, liens de tout le workspace, pierre
 * tombale dans ce repo. Un composant en lecture seule refuse (`NODE_READONLY`). Un ID introuvable
 * partout reste traité par le repo racine (`OBJECT_NOT_FOUND`), comme avant.
 */
async function runDeleteAcrossRepos(container: McpContainer, category: Category, ids: string[], dryRun: boolean): Promise<DeleteResult> {
  const scopes = await workspaceScopes(container)
  if (scopes.length === 1) return runDelete(container, category, ids, dryRun)
  const located: Array<{ index: number; scope: RepoScope; item: string }> = []
  for (const [index, id] of ids.entries()) {
    located.push({ index, scope: (await findOwnerScope(container, scopes, category, id)) ?? scopes[0], item: id })
  }
  const merged: DeleteResult = { dryRun, summary: { total: ids.length, ok: 0, failed: 0 }, wouldDelete: [], deleted: [], errors: [] }
  for (const { scope, items } of groupByScope(located)) {
    const indices = items.map(i => i.index)
    if (await isScopeReadonly(container, scope)) {
      merged.errors.push(...items.map(({ index, item: id }) => ({
        index, id, code: 'NODE_READONLY' as const, reason: `composant '${scope.component}' en lecture seule — suppression refusée`,
      })))
      continue
    }
    const r = await runDelete(scoped(container, scope), category, items.map(i => i.item), dryRun)
    merged.wouldDelete.push(...r.wouldDelete.map(w => ({ ...w, index: indices[w.index] })))
    merged.deleted.push(...r.deleted)
    merged.errors.push(...r.errors.map(e => ({ ...e, index: indices[e.index] })))
  }
  merged.errors.sort((a, b) => a.index - b.index)
  merged.wouldDelete.sort((a, b) => a.index - b.index)
  merged.summary.failed = merged.errors.length
  merged.summary.ok = dryRun ? merged.wouldDelete.length : merged.deleted.length
  return merged
}

const description = (what: string, extra: string) =>
  `Supprime définitivement des ${what} par ID, pour corriger un import (doublon, mauvais lot) — ` +
  "un objet abandonné passe plutôt au statut terminal de son type. dryRun (défaut true) : aperçu " +
  "(wouldDelete) et refus, SANS RIEN ÉCRIRE. Refus par objet, sans bloquer les autres : OBJECT_NOT_FOUND, " +
  `NODE_READONLY, OBJECT_IN_USE (lié à un objet — supprimer d'abord ses liens avec delete_links —, ${extra}, ` +
  "inclus dans une version, cité par une validation). dryRun: false : pierre tombale (l'ID n'est jamais " +
  "réattribué), fichier supprimé, en série, best-effort. Le rangement en dossiers n'est pas modifié. " +
  "Workspace : un objet d'un composant en repo séparé est supprimé dans le repo de ce composant."

export function registerDeleteObjectTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'delete_requirements',
    { title: 'Delete requirements', description: description('exigences', 'présent dans une campagne'), inputSchema: deleteInput },
    async ({ ids, dryRun }) => jsonToolResult(await runDeleteAcrossRepos(container, 'requirement', ids, dryRun)),
  )
  server.registerTool(
    'delete_tests',
    {
      title: 'Delete tests',
      description: description('cas de test', 'présent dans une campagne (testCaseIds ou exécution)') + ' Ses exécutions (test-runs/<ID>) sont supprimées avec lui.',
      inputSchema: deleteInput,
    },
    async ({ ids, dryRun }) => jsonToolResult(await runDeleteAcrossRepos(container, 'test', ids, dryRun)),
  )
}
