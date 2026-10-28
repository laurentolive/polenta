import { z } from 'zod'
import { PARAM_NAME_RE } from '@polenta/types'
import type { Parameter, RepoParameters } from '@polenta/types'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { errorToolResult, jsonToolResult } from '../mcp-types'

/**
 * Tools de la base de paramètres (GH150 — specs/GH150-design.md §Paramètres) : `list_parameters`,
 * `set_parameters`, `delete_parameter`. Écritures par `ParametersService` (format de l'appli, clés
 * triées, marquage `needsRevalidation` des éléments approuvés qui utilisent un paramètre modifié,
 * T171 §9). `repo` = nom de montage du repo cible (`list_parameters`), absent = repo ouvert.
 */

const parameterEntrySchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  unit: z.string().optional(),
  description: z.string().optional(),
}).strict()

type Resolved = { ok: true; repo: RepoParameters } | { ok: false; message: string }

async function resolveRepo(container: McpContainer, repo: string | undefined): Promise<Resolved> {
  const all = await container.parameters.list(container.repoPath, container.workspaceDir)
  const found = repo === undefined
    ? all.find(r => r.repoPath === container.repoPath)
    : all.find(r => r.repoName === repo)
  if (!found) return { ok: false, message: `repo inconnu : "${repo}" (repos : ${all.map(r => r.repoName).join(', ')})` }
  if (found.readonly) {
    return { ok: false, message: `READONLY_REPO : ${found.repoName} est en lecture seule, paramètres non modifiables` }
  }
  return { ok: true, repo: found }
}

/** Texte affiché d'une référence : seuls `value` / `unit` comptent (même règle que `ParametersService.update`). */
const textChanged = (before: Parameter, after: Parameter) =>
  (before.value ?? '') !== after.value || (before.unit ?? '') !== (after.unit ?? '')

export function registerParameterTools(server: McpServer, container: McpContainer): void {
  const { workspaceDir } = container

  server.registerTool(
    'list_parameters',
    {
      title: 'List parameters',
      description:
        "Liste la base de paramètres (parameters/parameters.yaml) de chaque repo visible du workspace, " +
        "avec le nombre d'exigences/tests qui référencent chaque paramètre ({nom} ou {<nœud>::nom}).",
      inputSchema: {},
    },
    async () => {
      const all = await container.parameters.list(container.repoPath, workspaceDir)
      return jsonToolResult(all.map(r => ({
        repo: r.repoName,
        ...(r.label && { label: r.label }),
        readonly: r.readonly,
        parameters: r.parameters.map(p => ({ ...p, usageCount: r.usageCounts[p.name] ?? 0 })),
      })))
    },
  )

  server.registerTool(
    'set_parameters',
    {
      title: 'Set parameters',
      description:
        "Crée ou modifie des paramètres (création si le nom est absent, modification sinon). dryRun " +
        "(défaut true) : retourne l'action prévue (create/update, avant/après) et les éléments approuvés " +
        "qui seraient marqués à revalider, SANS RIEN ÉCRIRE. dryRun: false : écrit en série, best-effort. " +
        "Ne jamais éditer parameters.yaml à la main.",
      inputSchema: {
        repo: z.string().optional(),
        entries: z.array(parameterEntrySchema),
        dryRun: z.boolean().optional().default(true),
      },
    },
    async ({ repo, entries, dryRun }) => {
      const resolved = await resolveRepo(container, repo)
      if (!resolved.ok) return errorToolResult(resolved.message)
      const { repoPath } = resolved.repo
      // Copie de travail : une entrée du lot peut créer un nom qu'une entrée suivante modifie.
      const known = new Map(resolved.repo.parameters.map(p => [p.name, p]))

      const results: Array<Record<string, unknown>> = []
      const errors: Array<{ index: number; name: string; reason: string }> = []
      for (const [index, entry] of entries.entries()) {
        if (!PARAM_NAME_RE.test(entry.name)) {
          errors.push({ index, name: entry.name, reason: 'nom invalide (lettres, chiffres, _ et - uniquement)' })
          continue
        }
        const before = known.get(entry.name)
        const after: Parameter = { ...entry }
        const action = before ? 'update' : 'create'
        if (dryRun) {
          const marks = !before || textChanged(before, after)
          const wouldMark = marks
            ? (await container.parameters.usages(repoPath, entry.name, workspaceDir)).filter(u => u.isApproval).map(u => u.elementId)
            : []
          results.push({ index, name: entry.name, action, ...(before && { before }), after, wouldMark })
          known.set(entry.name, after)
          continue
        }
        try {
          const { name, ...patch } = after
          const { marked } = before
            ? await container.parameters.update(repoPath, name, patch, workspaceDir)
            : await container.parameters.create(repoPath, after, workspaceDir)
          results.push({ index, name, action, marked: marked.map(m => m.id) })
          known.set(name, after)
        } catch (e) {
          errors.push({ index, name: entry.name, reason: e instanceof Error ? e.message : String(e) })
        }
      }
      return jsonToolResult({
        dryRun,
        repo: resolved.repo.repoName,
        summary: { total: entries.length, ok: results.length, failed: errors.length },
        [dryRun ? 'preview' : 'written']: results,
        errors,
      })
    },
  )

  server.registerTool(
    'delete_parameter',
    {
      title: 'Delete parameter',
      description:
        "Supprime un paramètre. Refusé tant qu'une exigence ou un test non terminal le référence : " +
        "le résultat liste alors ces utilisations (deleted: false), à corriger d'abord.",
      inputSchema: { repo: z.string().optional(), name: z.string().min(1) },
    },
    async ({ repo, name }) => {
      const resolved = await resolveRepo(container, repo)
      if (!resolved.ok) return errorToolResult(resolved.message)
      if (!resolved.repo.parameters.some(p => p.name === name)) {
        return errorToolResult(`paramètre inconnu : "${name}" dans ${resolved.repo.repoName}`)
      }
      const result = await container.parameters.delete(resolved.repo.repoPath, name, workspaceDir)
      return jsonToolResult({ repo: resolved.repo.repoName, name, ...result })
    },
  )
}
