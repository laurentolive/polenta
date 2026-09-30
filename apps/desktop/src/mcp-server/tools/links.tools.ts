import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ObjectLink } from '@polenta/types'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import { resolveWorkspaceRepoPaths } from '../../main/services/workspace-repos.util'
import {
  validateLinkEntries,
  type LinkEntryDto,
  type LinkEntryError,
  type ResolvedLinkObject,
} from '../../main/services/link-validation.util'

/**
 * Tools de gestion des liens (GH16 — specs/GH16-design.md) : `list_links`,
 * `create_links`, `delete_links`. Les liens sont toujours lus/écrits dans
 * `links/links.yaml` du repo ciblé (`container.repoPath`), jamais dans un composant.
 *
 * Chaque tool relit `links.yaml` depuis le disque (`reloadLinks`) : ce process n'a pas de
 * `RepoWatcherService`, son cache peut ignorer un lien créé entre-temps par l'app — une
 * écriture basée dessus l'écraserait.
 */

const linkEntrySchema = z.object({
  type: z.string().min(1).describe('linkTypes[].name du schéma (cf. get_schema)'),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
})

const listLinksInput = {
  objectId: z.string().optional().describe('ne garder que les liens dont cet objet est source ou cible'),
  type: z.string().optional().describe('ne garder que les liens de ce type'),
}

const createLinksInput = {
  entries: z.array(linkEntrySchema),
  dryRun: z.boolean().optional().default(true),
}

const deleteLinksInput = {
  ids: z.array(z.string().min(1)),
  dryRun: z.boolean().optional().default(true),
}

type ObjectTable = Map<string, ResolvedLinkObject>

/** Table id → objet (exigences, tests, campagnes) sur le repo ciblé + composants du workspace. */
async function buildObjectTable(container: McpContainer, repoPaths: string[]): Promise<ObjectTable> {
  const table: ObjectTable = new Map()
  for (const p of repoPaths) {
    const [reqs, tests, campaigns] = await Promise.all([
      container.requirements.findAll(p, {}),
      container.tests.findAll(p),
      container.campaigns.list(p),
    ])
    for (const r of reqs) table.set(r.id, { id: r.id, category: 'requirement', objectTypeRef: r.objectTypeRef })
    for (const t of tests) table.set(t.id, { id: t.id, category: 'test', objectTypeRef: t.objectTypeRef })
    for (const c of campaigns) table.set(c.id, { id: c.id, category: 'campaign', objectTypeRef: c.objectTypeRef })
  }
  return table
}

/**
 * Résout les IDs du lot ; si au moins un est introuvable, invalide les index (objet
 * possiblement créé par l'app après leur construction) et reconstruit la table une fois.
 */
async function resolveObjects(container: McpContainer, entries: LinkEntryDto[]): Promise<ObjectTable> {
  const repoPaths = await resolveWorkspaceRepoPaths(container.workspaceTree, container.repoPath, container.workspaceDir)
  let table = await buildObjectTable(container, repoPaths)
  const missing = entries.some((e) => !table.has(e.sourceId) || !table.has(e.targetId))
  if (missing) {
    for (const p of repoPaths) {
      container.reqIndex.invalidate(p)
      container.testsIndex.invalidate(p)
    }
    table = await buildObjectTable(container, repoPaths)
  }
  return table
}

export function registerLinkTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'list_links',
    {
      title: 'List links',
      description:
        'Liste les liens entre objets (links/links.yaml du repo). Filtres optionnels : ' +
        'objectId (liens dont cet objet est source OU cible), type (linkTypes[].name). ' +
        'Utile avant create_links pour éviter les doublons.',
      inputSchema: listLinksInput,
    },
    async ({ objectId, type }) => {
      let links = await container.requirements.reloadLinks(container.repoPath)
      if (objectId) links = links.filter((l) => l.sourceId === objectId || l.targetId === objectId)
      if (type) links = links.filter((l) => l.type === type)
      return jsonToolResult({ links })
    },
  )

  server.registerTool(
    'create_links',
    {
      title: 'Create links',
      description:
        "Crée des liens entre objets (exigences, tests, campagnes). dryRun (défaut true) : " +
        "valide chaque entrée et retourne un aperçu SANS RIEN ÉCRIRE. Validation : type " +
        "existant dans schema.linkTypes, pas d'auto-lien, objets existants, compatibilité " +
        "sourceRefs/targetRefs dans un sens ou dans l'autre (le sens fourni est conservé), " +
        "pas de doublon (même type et même paire, quel que soit le sens). dryRun: false : " +
        "écrit les entrées valides en une fois (best-effort : une entrée en erreur n'empêche " +
        "pas les autres). Appeler get_schema d'abord pour connaître les linkTypes.",
      inputSchema: createLinksInput,
    },
    async ({ entries, dryRun }) => {
      const schema = await container.schema.get(container.repoPath)
      const existing = await container.requirements.reloadLinks(container.repoPath)
      const table = await resolveObjects(container, entries)
      const { valid, errors } = validateLinkEntries(
        schema.linkTypes ?? [],
        entries,
        (id) => table.get(id) ?? null,
        existing,
      )
      const summary = { total: entries.length, ok: valid.length, failed: errors.length }

      if (dryRun) {
        return jsonToolResult({
          dryRun: true,
          summary,
          wouldCreate: valid.map((v) => ({ index: v.index, ...v.dto })),
          created: [],
          errors,
        })
      }

      const written = await container.requirements.createLinks(
        container.repoPath,
        valid.map((v) => v.dto),
        'mcp',
      )
      // createLinks refait le contrôle de doublon sous verrou : null = lien créé entre-temps
      // (autre appel MCP concurrent, ou l'app) — reporté comme doublon.
      const created: Array<{ index: number; id: string }> = []
      written.forEach((link, i) => {
        const { index, dto } = valid[i]
        if (link) created.push({ index, id: link.id })
        else errors.push({ index, code: 'DUPLICATE_LINK', reason: `Un lien "${dto.type}" relie déjà ${dto.sourceId} et ${dto.targetId} (créé entre-temps).` })
      })
      errors.sort((a, b) => a.index - b.index)
      return jsonToolResult({
        dryRun: false,
        summary: { total: entries.length, ok: created.length, failed: errors.length },
        wouldCreate: [],
        created,
        errors,
      })
    },
  )

  server.registerTool(
    'delete_links',
    {
      title: 'Delete links',
      description:
        'Supprime des liens par id (cf. list_links). dryRun (défaut true) : retourne les ' +
        'liens qui seraient supprimés, SANS RIEN ÉCRIRE. Un id introuvable est reporté ' +
        'dans errors (LINK_NOT_FOUND) sans empêcher la suppression des autres.',
      inputSchema: deleteLinksInput,
    },
    async ({ ids, dryRun }) => {
      const links = await container.requirements.reloadLinks(container.repoPath)
      const byId = new Map(links.map((l) => [l.id, l]))
      const found: ObjectLink[] = []
      const errors: LinkEntryError[] = []
      const seen = new Set<string>()
      ids.forEach((id, index) => {
        const link = byId.get(id)
        if (!link || seen.has(id)) {
          errors.push({ index, code: 'LINK_NOT_FOUND', reason: `Lien "${id}" introuvable${seen.has(id) ? ' (déjà traité dans ce lot)' : ''}.` })
          return
        }
        seen.add(id)
        found.push(link)
      })
      const summary = { total: ids.length, ok: found.length, failed: errors.length }

      if (dryRun) {
        return jsonToolResult({ dryRun: true, summary, wouldDelete: found, deleted: [], errors })
      }

      const deleted = await container.requirements.deleteLinks(container.repoPath, found.map((l) => l.id))
      // deleteLinks relit le fichier sous verrou : un lien supprimé entre-temps (par l'app)
      // n'est plus là — reporté comme introuvable plutôt que compté comme supprimé.
      const deletedSet = new Set(deleted)
      ids.forEach((id, index) => {
        if (found.some((l) => l.id === id) && !deletedSet.has(id) && !errors.some((e) => e.index === index)) {
          errors.push({ index, code: 'LINK_NOT_FOUND', reason: `Lien "${id}" supprimé entre-temps par un autre processus.` })
        }
      })
      errors.sort((a, b) => a.index - b.index)
      return jsonToolResult({
        dryRun: false,
        summary: { total: ids.length, ok: deleted.length, failed: errors.length },
        wouldDelete: [],
        deleted,
        errors,
      })
    },
  )
}
