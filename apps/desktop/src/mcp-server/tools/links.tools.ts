import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'

/**
 * Tools de gestion des liens (GH16 — specs/GH16-design.md) : `list_links`,
 * `create_links`, `delete_links`.
 *
 * GH105 — liens inter-repos (specs/GH105-design.md D7) : les liens sont lus dans les
 * `links/links.yaml` de tous les repos du workspace ; un lien est écrit dans le repo de l'objet
 * côté `sourceRefs` de son type (refus `READONLY_REPO` si ce repo est en lecture seule) et
 * supprimé dans le repo qui le stocke (`WorkspaceLinksService`).
 *
 * Chaque tool relit `links.yaml` depuis le disque (`fresh`) : ce process n'a pas de
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

export function registerLinkTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'list_links',
    {
      title: 'List links',
      description:
        'Liste les liens entre objets (links/links.yaml de tous les repos du workspace ; ' +
        'storedIn = repo qui stocke le lien, readonly = suppression impossible). Filtres optionnels : ' +
        'objectId (liens dont cet objet est source OU cible), type (linkTypes[].name). ' +
        'Utile avant create_links pour éviter les doublons.',
      inputSchema: listLinksInput,
    },
    async ({ objectId, type }) => {
      let links = await container.workspaceLinks.listLinks(container.repoPath, container.workspaceDir, true)
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
        "pas de doublon (même type et même paire, quel que soit le sens), repo de stockage " +
        "modifiable. Le lien est écrit dans le repo de l'objet côté sourceRefs (storedIn). dryRun: false : " +
        "écrit les entrées valides en une fois (best-effort : une entrée en erreur n'empêche " +
        "pas les autres). Appeler get_schema d'abord pour connaître les linkTypes.",
      inputSchema: createLinksInput,
    },
    async ({ entries, dryRun }) => {
      const links = container.workspaceLinks
      if (dryRun) {
        const { valid, errors } = await links.plan(container.repoPath, entries, container.workspaceDir, true)
        return jsonToolResult({
          dryRun: true,
          summary: { total: entries.length, ok: valid.length, failed: errors.length },
          wouldCreate: valid.map((v) => ({ index: v.index, ...v.dto, storedIn: v.storedIn })),
          created: [],
          errors,
        })
      }

      const { created, errors } = await links.createLinks(container.repoPath, entries, 'mcp', container.workspaceDir, true)
      return jsonToolResult({
        dryRun: false,
        summary: { total: entries.length, ok: created.length, failed: errors.length },
        wouldCreate: [],
        created: created.map((c) => ({ index: c.index, id: c.link.id, storedIn: c.link.storedIn })),
        errors,
      })
    },
  )

  server.registerTool(
    'delete_links',
    {
      title: 'Delete links',
      description:
        'Supprime des liens par id (cf. list_links), chacun dans le repo qui le stocke ; un lien ' +
        "d'un repo en lecture seule est reporté en erreur (READONLY_REPO). dryRun (défaut true) : retourne les " +
        'liens qui seraient supprimés, SANS RIEN ÉCRIRE. Un id introuvable est reporté ' +
        'dans errors (LINK_NOT_FOUND) sans empêcher la suppression des autres.',
      inputSchema: deleteLinksInput,
    },
    async ({ ids, dryRun }) => {
      const { deleted, errors } = await container.workspaceLinks.deleteLinks(container.repoPath, ids, container.workspaceDir, dryRun)
      const summary = { total: ids.length, ok: deleted.length, failed: errors.length }
      if (dryRun) return jsonToolResult({ dryRun: true, summary, wouldDelete: deleted, deleted: [], errors })
      return jsonToolResult({
        dryRun: false,
        summary,
        wouldDelete: [],
        deleted: deleted.map((l) => l.id),
        errors,
      })
    },
  )
}
