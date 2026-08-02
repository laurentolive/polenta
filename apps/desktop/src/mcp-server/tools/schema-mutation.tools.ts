import { z } from 'zod'
import type { ProjectSchema } from '@polenta/types'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { jsonToolResult, errorToolResult } from '../mcp-types'
import { SchemaValidationError } from '../../main/services/schema.service'

/**
 * Tools de mutation de schéma (T122 sprint 3 — specs/T122-design.md §4) : un tool
 * par méthode ciblée de `SchemaService` (`add_component`, `add_object_type`,
 * `add_field`, `add_status`, `add_link_type`). Chaque tool valide ses invariants
 * (collision de nom, prefix unique projet-wide, nœud `readonly`) AVANT d'écrire —
 * la validation elle-même vit dans `SchemaService`, ces tools ne font que traduire
 * `SchemaValidationError` en réponse MCP `isError: true` (cf. §5 du design) plutôt
 * que de laisser remonter une exception de protocole.
 *
 * `add_component` mappe vers `SchemaService.addNode` — nom de tool aligné sur le
 * vocabulaire du spec/UI ("composant"), nom de méthode aligné sur le type de
 * données (`SystemNode` → `addNode`) ; différence assumée, documentée ici pour
 * éviter la confusion à la prochaine lecture (cf. design §4.2).
 */

// ─── Zod schemas d'entrée ───────────────────────────────────────────────────────
//
// Pas de zod schema exporté aujourd'hui pour `ObjectTypeDefinition`/`SchemaField`/
// `SchemaStatus`/`LinkTypeDefinition` dans @polenta/zod-schemas (l'UI construit ces
// objets directement en TypeScript, sans validation runtime — StructureTab.tsx).
// Schémas locaux à ce fichier, même convention que `createCampaignEntrySchema` dans
// bulk-import.tools.ts (§3.2 du sprint précédent) : surface externe MCP, contrairement
// au code interne à l'app qui n'a pas besoin de cette validation runtime.

const schemaFieldTypeSchema = z.enum([
  'text', 'textarea', 'number', 'enum', 'multi_enum', 'boolean', 'date', 'datetime', 'richtext', 'user', 'drawio',
])

const schemaFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: schemaFieldTypeSchema,
  values: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  placeholder: z.string().optional(),
  validator: z.string().optional(),
})

const schemaStatusSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  color: z.string().optional(),
  isApproval: z.boolean().optional(),
  isTerminal: z.boolean().optional(),
})

const objectCategorySchema = z.enum(['requirement', 'test', 'campaign'])

const objectTypeDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  color: z.string().optional(),
  prefix: z.string().optional(),
  category: objectCategorySchema,
  fields: z.array(schemaFieldSchema).default([]),
  statuses: z.array(schemaStatusSchema).optional(),
})

const linkTypeDefinitionSchema = z.object({
  name: z.string().min(1),
  labelSourceToTarget: z.string().min(1),
  labelTargetToSource: z.string().min(1),
  sourceRefs: z.array(z.string()).optional(),
  targetRefs: z.array(z.string()).optional(),
})

const addComponentInput = {
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  readonly: z.boolean().optional(),
  // T123 — nom d'un composant local existant du même projet sous lequel imbriquer le nouveau
  // composant (children[]). Absent : ajout au niveau racine de schema.nodes[], comportement T113
  // inchangé. Ne peut désigner qu'un composant du MÊME repo (container.repoPath) — un composant
  // en repo séparé n'est jamais un parent valide, cf. specs/T123.md §Comportement attendu #3.
  parentName: z.string().optional(),
}

const addObjectTypeInput = {
  nodeName: z.string().min(1),
  objectType: objectTypeDefinitionSchema,
}

const addFieldInput = {
  nodeName: z.string().min(1),
  typeName: z.string().min(1),
  field: schemaFieldSchema,
}

const addStatusInput = {
  nodeName: z.string().min(1),
  typeName: z.string().min(1),
  status: schemaStatusSchema,
}

const addLinkTypeInput = {
  linkType: linkTypeDefinitionSchema,
}

type SchemaMutationToolResult = ReturnType<typeof jsonToolResult> | ReturnType<typeof errorToolResult>

/**
 * Exécute une mutation de schéma et traduit `SchemaValidationError` en réponse MCP
 * `isError: true` (cf. §5 du design) — factorisé (trouvé en revue de code) plutôt
 * que répété try/catch par try/catch dans chacun des 5 handlers ci-dessous, qui
 * suivaient tous exactement le même schéma. Une erreur inattendue (pas
 * `SchemaValidationError`) continue de remonter telle quelle, jamais avalée.
 */
async function runSchemaMutation(op: () => Promise<ProjectSchema>): Promise<SchemaMutationToolResult> {
  try {
    return jsonToolResult(await op())
  } catch (e) {
    if (e instanceof SchemaValidationError) return errorToolResult(`[${e.code}] ${e.message}`)
    throw e
  }
}

export function registerSchemaMutationTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'add_component',
    {
      title: 'Add component',
      description:
        'Ajoute un composant (SystemNode) local au projet — pas de repo séparé/submodule ' +
        "(un agent ne crée pas de submodule, cf. T113). Refusé si le nom est déjà pris par " +
        'un composant existant (y compris "root"), à n\'importe quelle profondeur. Le composant ' +
        "créé démarre sans type d'objet (objectTypes: []) et readonly: false par défaut. " +
        'Avec `parentName` (T123) : imbrique le nouveau composant dans les enfants du composant ' +
        'local désigné (profondeur non limitée) au lieu de l\'ajouter au niveau racine.',
      inputSchema: addComponentInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.addNode(container.repoPath, dto)),
  )

  server.registerTool(
    'add_object_type',
    {
      title: 'Add object type',
      description:
        "Ajoute un type d'objet (ObjectTypeDefinition) à un composant existant. Refusé si " +
        "le composant est introuvable ou readonly, si le nom du type est déjà pris dans ce " +
        "composant, ou si prefix est déjà utilisé par un type de N'IMPORTE QUEL composant " +
        "du projet (règle 10 de CLAUDE.md — prefix unique projet-wide). Appeler get_schema " +
        "d'abord pour connaître les composants et prefixes déjà utilisés.",
      inputSchema: addObjectTypeInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.addObjectType(container.repoPath, dto)),
  )

  server.registerTool(
    'add_field',
    {
      title: 'Add field',
      description:
        "Ajoute un champ (SchemaField) à un type d'objet existant. Refusé si le composant " +
        "ou le type est introuvable, si le composant est readonly, ou si un champ de ce " +
        'nom existe déjà dans ce type.',
      inputSchema: addFieldInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.addField(container.repoPath, dto)),
  )

  server.registerTool(
    'add_status',
    {
      title: 'Add status',
      description:
        "Ajoute un statut (SchemaStatus) à un type d'objet existant. Refusé si le composant " +
        "ou le type est introuvable, si le composant est readonly, ou si un statut de ce " +
        'nom existe déjà dans ce type.',
      inputSchema: addStatusInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.addStatus(container.repoPath, dto)),
  )

  server.registerTool(
    'add_link_type',
    {
      title: 'Add link type',
      description:
        'Ajoute un type de lien (LinkTypeDefinition) au projet — pas rattaché à un ' +
        "composant particulier. Refusé si un type de lien de ce nom existe déjà.",
      inputSchema: addLinkTypeInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.addLinkType(container.repoPath, dto)),
  )
}
