import { z } from 'zod'
import type { ProjectSchema } from '@polenta/types'
import { CreateRequirementSchema, CreateTestCaseSchema } from '@polenta/zod-schemas'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GitService } from '../../main/services/git.service'
import type { McpContainer } from '../container'
import { jsonToolResult } from '../mcp-types'
import {
  validateBulkEntries,
  resolveIdPrefix,
  type BulkEntryError,
  type BulkImportEntryDto,
} from '../../main/services/bulk-import-validation.util'
import { peekNextCounterId, formatCounterId } from '../../main/services/id-counter.util'

/**
 * Tools d'import massif (T122 sprint 2 — specs/T122-design.md §3) : un tool par
 * catégorie (`bulk_import_requirements`/`bulk_import_tests`/`bulk_import_campaigns`),
 * chacun avec un mode `dryRun` obligatoire par défaut (`true`) — cf. garde-fou acté
 * dans specs/T122.md.
 *
 * `dryRun: true` : valide chaque entrée (`bulk-import-validation.util.ts`) et
 * retourne l'aperçu (IDs prévisionnels + erreurs), SANS AUCUNE écriture disque.
 * `dryRun: false` : réutilise `RequirementsService.create`/`TestsService.create`/
 * `CampaignsService.create` EN SÉRIE (jamais `Promise.all` — l'ordre conditionne les
 * IDs attribués par `nextCounterId`, et le comportement est best-effort/non
 * transactionnel : un échec sur une entrée n'annule pas les précédentes déjà écrites).
 */

// ─── Zod schemas d'entrée ───────────────────────────────────────────────────────

// `CreateRequirementSchema`/`CreateTestCaseSchema` sont réutilisés tel quel
// (@polenta/zod-schemas) — mêmes DTOs que l'UI, pas de duplication de règles.
const bulkImportRequirementsInput = {
  entries: z.array(CreateRequirementSchema),
  dryRun: z.boolean().optional().default(true),
}

const bulkImportTestsInput = {
  entries: z.array(CreateTestCaseSchema),
  dryRun: z.boolean().optional().default(true),
}

// `CreateCampaignDto` (packages/types/src/campaign.ts) n'a pas de zod schema exporté
// aujourd'hui (l'IPC `campaigns:create` existant caste `unknown` sans validation
// runtime, cf. main/ipc/index.ts) — un schema local est introduit ici pour ce tool
// MCP uniquement (surface externe, contrairement à l'IPC interne à l'app).
const createCampaignEntrySchema = z.object({
  title: z.string().min(1),
  objectTypeRef: z.string().optional(),
  fields: z.record(z.unknown()).optional(),
  baselineRef: z.string().optional(),
  component: z.string().optional(),
  level: z.string().optional(),
  testCaseIds: z.array(z.string()).default([]),
  paramValuesByTest: z.record(z.record(z.string())).optional(),
})

const bulkImportCampaignsInput = {
  entries: z.array(createCampaignEntrySchema),
  dryRun: z.boolean().optional().default(true),
}

// ─── Résultat commun ────────────────────────────────────────────────────────────

interface BulkImportToolResult {
  dryRun: boolean
  summary: { total: number; ok: number; failed: number }
  /** `dryRun: false` uniquement — IDs réels des objets effectivement créés. */
  created: Array<{ index: number; id: string }>
  /** `dryRun: true` uniquement — IDs prévisionnels. */
  wouldCreate: Array<{ index: number; id: string }>
  errors: BulkEntryError[]
}

/**
 * `nextIdPreview` factice utilisé quand `dryRun: false` — `validateBulkEntries`
 * appelle ce callback pour renseigner `predictedId` sur chaque entrée valide, mais
 * `runBulkImport` n'utilise `predictedId` QUE dans la branche `dryRun: true` (la
 * branche d'écriture réelle prend son ID dans la valeur retournée par `create()`,
 * seule source de vérité). Calculer un vrai aperçu (donc lister le dossier et les
 * pierres tombales via `peekNextCounterId`) avant une écriture réelle serait un
 * aller-retour disque entièrement gaspillé, doublé par la lecture déjà faite en
 * série par le vrai `nextCounterId` à l'intérieur de `create()` — relevé en review.
 */
const NOOP_ID_PREVIEW = (): string => ''

/**
 * Exécute la validation + (selon `dryRun`) l'aperçu ou l'écriture réelle pour un
 * batch d'une catégorie donnée. Générique sur `TDto` : partagé par les 3 tools.
 */
async function runBulkImport<TDto extends BulkImportEntryDto>(
  schema: ProjectSchema,
  entries: TDto[],
  dryRun: boolean,
  nextIdPreview: (objectTypeRef: string | undefined) => string,
  create: (dto: TDto) => Promise<{ id: string }>,
): Promise<BulkImportToolResult> {
  const { valid, errors } = validateBulkEntries(schema, entries, nextIdPreview)

  if (dryRun) {
    return {
      dryRun: true,
      summary: { total: entries.length, ok: valid.length, failed: errors.length },
      created: [],
      wouldCreate: valid.map((v) => ({ index: v.index, id: v.predictedId })),
      errors: [...errors].sort((a, b) => a.index - b.index),
    }
  }

  const created: Array<{ index: number; id: string }> = []
  const writeErrors: BulkEntryError[] = []
  // Série, jamais Promise.all — l'ordre conditionne les IDs attribués par
  // nextCounterId, et le spec demande explicitement un comportement best-effort non
  // transactionnel : une entrée qui échoue à l'écriture n'annule pas les précédentes.
  for (const entry of valid) {
    try {
      const obj = await create(entry.dto)
      created.push({ index: entry.index, id: obj.id })
    } catch (e) {
      writeErrors.push({ index: entry.index, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  const allErrors = [...errors, ...writeErrors].sort((a, b) => a.index - b.index)
  return {
    dryRun: false,
    summary: { total: entries.length, ok: created.length, failed: allErrors.length },
    created,
    wouldCreate: [],
    errors: allErrors,
  }
}

/**
 * Construit le callback `nextIdPreview` pour les catégories dont le préfixe d'ID
 * dépend du type résolu (requirements/tests) — lit la base de compteur une seule
 * fois par préfixe DISTINCT présent dans le batch (pas un appel disque par entrée),
 * puis tient un offset en mémoire par préfixe pour que les IDs prévisionnels d'un
 * même batch soient distincts (cf. doc de `validateBulkEntries`).
 *
 * GH20 — la base se lit dans le repo qui recevra les fichiers (repo du composant pour un
 * type de composant, résolu comme `RequirementsService`/`TestsService.create`), pas
 * forcément `container.repoPath` : les IDs sont désormais déduits des fichiers sur disque.
 */
async function makeSchemaBackedIdPreview(
  container: McpContainer,
  schema: ProjectSchema,
  entries: BulkImportEntryDto[],
  dir: string,
): Promise<(objectTypeRef: string | undefined) => string> {
  const refByPrefix = new Map<string, string>()
  for (const e of entries) {
    const prefix = resolveIdPrefix(schema, e.objectTypeRef ?? '')
    if (!refByPrefix.has(prefix)) refByPrefix.set(prefix, e.objectTypeRef ?? '')
  }
  const baseByPrefix = new Map<string, number>()
  for (const [prefix, objectTypeRef] of refByPrefix) {
    const targetRepo = (await container.schema.resolveComponentRepoPath(
      container.repoPath, objectTypeRef, container.workspaceDir,
    )) ?? container.repoPath
    const historyRepos = targetRepo === container.repoPath ? [] : [container.repoPath]
    baseByPrefix.set(prefix, await peekNextCounterId(container.git, targetRepo, prefix, dir, historyRepos))
  }

  const usedByPrefix = new Map<string, number>()
  return (objectTypeRef: string | undefined): string => {
    const prefix = resolveIdPrefix(schema, objectTypeRef ?? '')
    const offset = usedByPrefix.get(prefix) ?? 0
    usedByPrefix.set(prefix, offset + 1)
    const base = baseByPrefix.get(prefix) ?? 1
    return formatCounterId(prefix, base + offset)
  }
}

/**
 * Construit le callback `nextIdPreview` pour les campagnes — préfixe TOUJOURS `CAMP`
 * (`CampaignsService.nextCampaignId()`), indépendamment de `objectTypeRef` (une
 * campagne n'a pas forcément de type, et même quand elle en a un, l'ID n'en dérive
 * pas — cf. commentaire sur `BulkImportEntryDto.objectTypeRef`).
 */
async function makeCampaignIdPreview(
  git: GitService,
  repoPath: string,
): Promise<(objectTypeRef: string | undefined) => string> {
  const base = await peekNextCounterId(git, repoPath, 'CAMP', 'campaigns')
  let offset = 0
  return (): string => {
    const id = formatCounterId('CAMP', base + offset)
    offset += 1
    return id
  }
}

export function registerBulkImportTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'bulk_import_requirements',
    {
      title: 'Bulk import requirements',
      description:
        "Crée plusieurs exigences en une fois. dryRun (défaut true) : valide chaque " +
        "entrée (objectTypeRef résolu, champs required, syntaxe EARS si validator: " +
        "EARS, nœud pas readonly) et retourne un aperçu (IDs prévisionnels + erreurs) " +
        "SANS RIEN ÉCRIRE. dryRun: false : écrit réellement, en série, best-effort " +
        "(une entrée en échec n'annule pas les précédentes). Appeler get_schema " +
        "d'abord pour connaître les objectTypeRef valides et leurs champs requis.",
      inputSchema: bulkImportRequirementsInput,
    },
    async ({ entries, dryRun }) => {
      const schema = await container.schema.get(container.repoPath)
      const preview = dryRun
        ? await makeSchemaBackedIdPreview(container, schema, entries, 'requirements')
        : NOOP_ID_PREVIEW
      const result = await runBulkImport(schema, entries, dryRun, preview, (dto) =>
        container.requirements.create(container.repoPath, dto, container.workspaceDir),
      )
      return jsonToolResult(result)
    },
  )

  server.registerTool(
    'bulk_import_tests',
    {
      title: 'Bulk import tests',
      description:
        "Crée plusieurs cas de test en une fois. Mêmes règles que " +
        "bulk_import_requirements (dryRun par défaut true, validation par entrée, " +
        "écriture série best-effort en dryRun: false).",
      inputSchema: bulkImportTestsInput,
    },
    async ({ entries, dryRun }) => {
      const schema = await container.schema.get(container.repoPath)
      const preview = dryRun
        ? await makeSchemaBackedIdPreview(container, schema, entries, 'tests')
        : NOOP_ID_PREVIEW
      const result = await runBulkImport(schema, entries, dryRun, preview, (dto) =>
        container.tests.create(container.repoPath, dto, container.workspaceDir),
      )
      return jsonToolResult(result)
    },
  )

  server.registerTool(
    'bulk_import_campaigns',
    {
      title: 'Bulk import campaigns',
      description:
        "Crée plusieurs campagnes de test en une fois. Mêmes règles que " +
        "bulk_import_requirements (dryRun par défaut true, écriture série best-effort " +
        "en dryRun: false). objectTypeRef est optionnel pour une campagne (catégorisée " +
        "par component/level plutôt que par type) — quand absent, aucune validation de " +
        "schéma ne s'applique à l'entrée (toujours valide de ce point de vue).",
      inputSchema: bulkImportCampaignsInput,
    },
    async ({ entries, dryRun }) => {
      const schema = await container.schema.get(container.repoPath)
      const preview = dryRun ? await makeCampaignIdPreview(container.git, container.repoPath) : NOOP_ID_PREVIEW
      const result = await runBulkImport(schema, entries, dryRun, preview, (dto) =>
        container.campaigns.create(container.repoPath, dto),
      )
      return jsonToolResult(result)
    },
  )
}
