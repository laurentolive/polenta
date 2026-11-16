import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { McpContainer } from '../container'
import { jsonToolResult, errorToolResult } from '../mcp-types'
import { SchemaValidationError } from '../../main/services/schema.service'
import { matchesRefs, type ResolvedLinkObject } from '../../main/services/link-validation.util'
import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { findSystemNode } from '@polenta/types'

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
 *
 * GH371 — modification d'un type existant : `add_field { list: 'entryFields' }`, décisions de
 * validation (`add_decision` / `update_decision` / `remove_decision`), statuts (`update_status` /
 * `remove_status` / `reorder_statuses`) et `update_object_type` (specs/GH371-design.md).
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
  'text', 'textarea', 'number', 'enum', 'multi_enum', 'boolean', 'date', 'datetime', 'richtext', 'user', 'drawio', 'link',
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
  /** GH77 — historiser les changements de ce champ (`history.<name>`). */
  trackHistory: z.boolean().optional(),
  /** GH195 — champ `link` : liste de liens. */
  multiple: z.boolean().optional(),
  /** GH195 — obligatoire quand un champ (`status`, enum, multi_enum, boolean du type) a une des valeurs. */
  requiredWhen: z.record(z.string(), z.array(z.union([z.string(), z.boolean()])).min(1)).optional(),
  /** GH139 — colonne affichée par défaut dans les vues (défaut de l'équipe). */
  defaultVisible: z.boolean().optional(),
})

const schemaStatusSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  color: z.string().optional(),
  isApproval: z.boolean().optional(),
  isTerminal: z.boolean().optional(),
})

// GH377 — `version` et `validation` : un seul type de chaque par repo, sur `root` (garde-fous de `SchemaService.save`).
const objectCategorySchema = z.enum(['requirement', 'test', 'campaign', 'issue', 'version', 'validation'])

/** GH204 — décision de validation (`ValidationDecisionDef`). */
const validationDecisionSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  color: z.string().optional(),
  isPending: z.boolean().optional(),
  proposesIssue: z.boolean().optional(),
})

const objectTypeDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  color: z.string().optional(),
  prefix: z.string().optional(),
  category: objectCategorySchema,
  fields: z.array(schemaFieldSchema).default([]),
  statuses: z.array(schemaStatusSchema).optional(),
  /** GH77 — historiser le statut (défaut true ; écrire false pour le désactiver). */
  trackStatusHistory: z.boolean().optional(),
  /** GH229 — champ affiché à la place de l'ID dans les liens (`title`, ou champ text / number / enum). */
  displayIdField: z.string().optional(),
  /** GH377 — type validation : décisions (défauts de l'éditeur si absent) et champs d'entrée. */
  decisions: z.array(validationDecisionSchema).optional(),
  entryFields: z.array(schemaFieldSchema).optional(),
})

const linkTypeDefinitionSchema = z.object({
  name: z.string().min(1),
  labelSourceToTarget: z.string().min(1),
  labelTargetToSource: z.string().min(1),
  sourceRefs: z.array(z.string()).optional(),
  targetRefs: z.array(z.string()).optional(),
  /** GH139 — colonne(s) de ce type de lien affichée(s) par défaut dans les vues. */
  defaultVisible: z.boolean().optional(),
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
  /** GH196 — liste visée : champs de l'objet (défaut), champs d'exécution ou d'étape (types de test) ;
   *  GH371 — champs d'entrée d'une validation. */
  list: z.enum(['fields', 'runFields', 'stepFields', 'entryFields']).optional(),
}

const addStatusInput = {
  nodeName: z.string().min(1),
  typeName: z.string().min(1),
  status: schemaStatusSchema,
}

const addLinkTypeInput = {
  linkType: linkTypeDefinitionSchema,
}

// ── GH371 — modification d'un type existant ────────────────────────────────────

const typeTarget = {
  nodeName: z.string().min(1),
  typeName: z.string().min(1),
}

/** `null` retire la clé du YAML. */
const removableString = z.string().min(1).nullable().optional()

const addDecisionInput = { ...typeTarget, decision: validationDecisionSchema }

const updateDecisionInput = {
  ...typeTarget,
  name: z.string().min(1),
  to: z.string().min(1).optional().describe('Nouveau nom (refusé si une entrée porte la décision)'),
  label: removableString,
  color: removableString,
  isPending: z.literal(true).optional().describe('Déplace la marque « en attente » sur cette décision'),
  proposesIssue: z.boolean().optional(),
}

const removeDecisionInput = { ...typeTarget, name: z.string().min(1) }

const reorderStatusesInput = { ...typeTarget, order: z.array(z.string().min(1)) }

const dryRunInput = z.boolean().optional().describe('true : aucun écrit, mêmes refus, aperçu (withOld / withNew)')

/** GH384 — schéma résolu complet dans la réponse (sinon : le seul type modifié). */
const includeSchemaInput = z.boolean().optional().describe('true : réponse avec le schéma complet (`schema`) au lieu du seul type modifié (`type`)')

const updateStatusInput = {
  ...typeTarget,
  name: z.string().min(1),
  to: z.string().min(1).optional().describe('Nouveau nom : objets du type, transitions et requiredWhen migrés'),
  label: removableString,
  color: removableString,
  isApproval: z.boolean().optional().describe('false retire la marque'),
  isTerminal: z.boolean().optional().describe('false retire la marque'),
  dryRun: dryRunInput,
  includeSchema: includeSchemaInput,
}

const removeStatusInput = {
  ...typeTarget,
  name: z.string().min(1),
  replaceWith: z.string().min(1).optional().describe('Statut existant vers lequel migrer les objets (fusion)'),
  dryRun: dryRunInput,
  includeSchema: includeSchemaInput,
}

/** GH384 — `update_link_type`. */
const updateLinkTypeInput = {
  name: z.string().min(1).describe('Nom du type de lien (non modifiable)'),
  labelSourceToTarget: z.string().min(1).optional(),
  labelTargetToSource: z.string().min(1).optional(),
  defaultVisible: z.boolean().optional().describe('false retire la marque'),
  sourceRefs: z.array(z.string().min(1)).nullable().optional().describe('Remplace la liste ; null retire la restriction'),
  targetRefs: z.array(z.string().min(1)).nullable().optional().describe('Remplace la liste ; null retire la restriction'),
}

/**
 * GH384 — IDs des liens existants du type que `next` n'accepterait plus, dans aucun sens (même règle
 * que la création, `matchesRefs`). Une extrémité introuvable (objet supprimé, repo absent) ne bloque pas.
 */
async function linksBrokenBy(container: McpContainer, next: { name: string; sourceRefs?: string[]; targetRefs?: string[] }): Promise<string[]> {
  const { repoPath, workspaceDir } = container
  const links = (await container.workspaceLinks.listLinks(repoPath, workspaceDir, true)).filter((l) => l.type === next.name)
  if (links.length === 0) return []
  const objects = new Map<string, ResolvedLinkObject>()
  for (const o of await container.workspaceLinks.listObjects(repoPath, workspaceDir)) {
    objects.set(o.id, { id: o.id, category: o.category, objectTypeRef: o.objectTypeRef })
  }
  for (const c of await container.campaigns.list(repoPath)) {
    if (!objects.has(c.id)) objects.set(c.id, { id: c.id, category: 'campaign', objectTypeRef: c.objectTypeRef ?? '' })
  }
  return links.filter((l) => {
    const [a, b] = [objects.get(l.sourceId), objects.get(l.targetId)]
    if (!a || !b) return false
    const ok = (s: ResolvedLinkObject, t: ResolvedLinkObject) => matchesRefs(s, next.sourceRefs) && matchesRefs(t, next.targetRefs)
    return !ok(a, b) && !ok(b, a)
  }).map((l) => l.id)
}

const updateObjectTypeInput = {
  ...typeTarget,
  label: removableString,
  color: removableString,
  displayIdField: removableString.describe('`title` ou un champ text / number / enum du type ; null : ID affiché'),
  trackStatusHistory: z.boolean().optional(),
}

/**
 * « Au moins une propriété à modifier » : l'API `registerTool` prend une forme zod brute, sans
 * `refine` au niveau de l'objet — même réponse que l'échec de validation d'entrée du SDK.
 */
function requireSomeChange(tool: string, dto: Record<string, unknown>, keys: string[]): void {
  if (keys.some((k) => dto[k] !== undefined)) return
  throw new McpError(ErrorCode.InvalidParams, `Input validation error: Invalid arguments for tool ${tool}: au moins une propriété à modifier (${keys.join(', ')}).`)
}

type SchemaMutationToolResult = ReturnType<typeof jsonToolResult> | ReturnType<typeof errorToolResult>

/**
 * Exécute une mutation de schéma et traduit `SchemaValidationError` en réponse MCP
 * `isError: true` (cf. §5 du design) — factorisé (trouvé en revue de code) plutôt
 * que répété try/catch par try/catch dans chacun des 5 handlers ci-dessous, qui
 * suivaient tous exactement le même schéma. Une erreur inattendue (pas
 * `SchemaValidationError`) continue de remonter telle quelle, jamais avalée.
 */
async function runSchemaMutation(op: () => Promise<unknown>): Promise<SchemaMutationToolResult> {
  try {
    return jsonToolResult(await op())
  } catch (e) {
    if (e instanceof SchemaValidationError) return errorToolResult(`[${e.code}] ${e.message}`)
    throw e
  }
}

/**
 * GH384 — réponse de `update_status` / `remove_status` : le schéma résolu complet (plusieurs centaines
 * de lignes sur un vrai projet) sature le contexte de l'agent ; seul le type modifié est rendu, sauf
 * `includeSchema`.
 */
async function statusMutation(
  dto: { nodeName: string; typeName: string; includeSchema?: boolean },
  op: () => Promise<{ schema: ProjectSchema }>,
): Promise<SchemaMutationToolResult> {
  return runSchemaMutation(async () => {
    const { schema, ...rest } = await op()
    if (dto.includeSchema) return { schema, ...rest }
    const type: ObjectTypeDefinition | undefined = findSystemNode(schema.nodes, dto.nodeName)?.objectTypes?.find(t => t.name === dto.typeName)
    return { type, ...rest }
  })
}

/**
 * GH371 — ce process n'a pas de watcher : un objet créé ou modifié par l'application depuis le
 * dernier appel doit compter (STATUS_IN_USE) et être migré.
 */
function freshenObjectIndexes(container: McpContainer): void {
  container.reqIndex.invalidate(container.repoPath)
  container.testsIndex.invalidate(container.repoPath)
  container.issues.invalidate(container.repoPath)
}

export function registerSchemaMutationTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'add_component',
    {
      title: 'Add component',
      description:
        'Ajoute un composant (SystemNode) local au projet — pas de repo séparé ' +
        "(un agent ne crée pas de composant en repo séparé, cf. T113). Refusé si le nom est déjà pris par " +
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
        "d'abord pour connaître les composants et prefixes déjà utilisés. " +
        "Catégories version et validation (GH377) : un seul type de chaque par repo, sur le nœud root, " +
        "prefix obligatoire. statuses absent → statuts par défaut de l'application (version : en_cours, " +
        "released [isApproval], abandonnee [isTerminal] ; validation : en_cours, signee [isApproval], " +
        "annulee [isTerminal]) ; une liste fournie est prise telle quelle. Une version a exactement un " +
        "statut isApproval. Validation : decisions absent → en_attente [isPending], conforme, " +
        "non_conforme [proposesIssue], hors_scope, derogation [proposesIssue] ; exactement une décision " +
        "isPending, un statut isApproval, un isTerminal, premier statut non marqué ; entryFields : champs " +
        "remplis par décision (nom \"decision\" réservé, requiredWhen sur les autres champs d'entrée ou " +
        "sur decision avec des noms de décisions existants). decisions / entryFields refusés pour les " +
        "autres catégories.",
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
        'nom existe déjà dans ce type. `list` : `fields` (défaut), `runFields` / `stepFields` (types de test), ' +
        '`entryFields` (champs d\'entrée du type validation ; nom `decision` réservé ; `requiredWhen` sur les autres ' +
        'champs d\'entrée ou sur le pseudo-champ `decision` et ses valeurs, sinon REQUIRED_WHEN_INVALID).',
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

  server.registerTool(
    'add_decision',
    {
      title: 'Add validation decision',
      description:
        "Ajoute une décision (decisions[]) au type validation, en fin de liste. Refusé : type d'une autre catégorie " +
        '(VALIDATION_TYPE_INVALID), nom déjà pris (DECISION_NAME_TAKEN), `isPending: true` alors qu\'une décision en ' +
        'attente existe (VALIDATION_TYPE_INVALID — update_decision déplace la marque).',
      inputSchema: addDecisionInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.addDecision(container.repoPath, dto)),
  )

  server.registerTool(
    'update_decision',
    {
      title: 'Update validation decision',
      description:
        "Modifie une décision du type validation : `label` / `color` (null retire), `proposesIssue` (false retire), " +
        '`isPending: true` (la marque « en attente » quitte l\'ancienne décision), `to` (renommage ; les requiredWhen ' +
        'des entryFields qui la citent suivent). Renommage et `isPending` refusés si une entrée d\'une validation ' +
        '(signées comprises) porte la décision (DECISION_IN_USE). Autres refus : DECISION_NOT_FOUND, DECISION_NAME_TAKEN.',
      inputSchema: updateDecisionInput,
    },
    async (dto) => {
      requireSomeChange('update_decision', dto, ['to', 'label', 'color', 'isPending', 'proposesIssue'])
      return runSchemaMutation(() => container.schema.updateDecision(container.repoPath, dto))
    },
  )

  server.registerTool(
    'remove_decision',
    {
      title: 'Remove validation decision',
      description:
        'Retire une décision du type validation. Refusé : décision en attente (VALIDATION_TYPE_INVALID), portée par ' +
        "une entrée d'une validation (DECISION_IN_USE, IDs cités), citée par le requiredWhen d'un entryField " +
        '(REQUIRED_WHEN_INVALID), introuvable (DECISION_NOT_FOUND).',
      inputSchema: removeDecisionInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.removeDecision(container.repoPath, dto)),
  )

  server.registerTool(
    'reorder_statuses',
    {
      title: 'Reorder statuses',
      description:
        "Réordonne les statuts d'un type : `order` = permutation exacte de leurs noms (sinon STATUS_LIST_INVALID). " +
        'Le premier statut est celui de création ; sur le type validation il ne peut être ni signée ni annulée ' +
        "(VALIDATION_TYPE_INVALID). Aucun objet modifié. Type campagne (statuts fixes) : STATUS_LIST_INVALID.",
      inputSchema: reorderStatusesInput,
    },
    async (dto) => runSchemaMutation(() => container.schema.reorderStatuses(container.repoPath, dto)),
  )

  server.registerTool(
    'update_status',
    {
      title: 'Update status',
      description:
        "Modifie un statut d'un type : `label` / `color` (null retire), `isApproval` / `isTerminal` (false retire), " +
        '`to` (renommage : statut courant et history.status des exigences, tests, campagnes, issues, validations et ' +
        'versions du type (version released / abandonnée : historique seul), copies testSnapshot des campagnes pour un type de test, règles de transition et requiredWhen qui le ' +
        'citent). Réponse { type, migration: { migrated, skipped, failed, snapshots? } } ; `dryRun: true` : ' +
        '{ dryRun, type, preview: { withOld, withNew } } sans rien écrire ; `type` = le type modifié, ' +
        '`includeSchema: true` rend le schéma complet (`schema`) à la place. Refus : STATUS_NOT_FOUND, ' +
        'STATUS_NAME_TAKEN (fusion : remove_status + replaceWith), VALIDATION_TYPE_INVALID / VERSION_TYPE_INVALID ' +
        '(marques du type validation / version, figées tant que des validations / versions existent), ' +
        'TRANSITION_INVALID, STATUS_LIST_INVALID (campagne : statuts fixes).',
      inputSchema: updateStatusInput,
    },
    async (dto) => {
      requireSomeChange('update_status', dto, ['to', 'label', 'color', 'isApproval', 'isTerminal'])
      freshenObjectIndexes(container)
      return statusMutation(dto, () => container.schema.updateStatus(container.repoPath, dto, container.fieldRename))
    },
  )

  server.registerTool(
    'remove_status',
    {
      title: 'Remove status',
      description:
        "Retire un statut d'un type. Statut courant d'au moins un objet du type : refusé (STATUS_IN_USE, nombre et " +
        'IDs) sauf `replaceWith` (statut existant) : les objets y sont migrés (statut, history.status, copies ' +
        'testSnapshot) et les règles de transition / requiredWhen qui citaient le statut sont réécrites vers lui. ' +
        'Sans replaceWith, un statut cité par une transition (TRANSITION_INVALID) ou un requiredWhen ' +
        "(REQUIRED_WHEN_INVALID) ne se retire pas. Le premier statut peut être retiré (le suivant devient celui de " +
        'création). Autres refus : STATUS_NOT_FOUND, STATUS_LIST_INVALID (dernier statut, replaceWith = name, ' +
        'campagne), VALIDATION_TYPE_INVALID / VERSION_TYPE_INVALID. Réponse et `dryRun` : comme update_status.',
      inputSchema: removeStatusInput,
    },
    async (dto) => {
      freshenObjectIndexes(container)
      return statusMutation(dto, () => container.schema.removeStatus(container.repoPath, dto, container.fieldRename))
    },
  )

  server.registerTool(
    'update_link_type',
    {
      title: 'Update link type',
      description:
        "Modifie un type de lien existant (GH384) : labelSourceToTarget / labelTargetToSource, defaultVisible " +
        "(colonne affichée par défaut dans les vues ; false retire), sourceRefs / targetRefs (liste remplacée en " +
        "bloc, catégories ou `<nœud>::<type>` ; null retire la restriction). Le nom ne se modifie pas. Refus : " +
        'LINK_TYPE_NOT_FOUND ; LINK_TYPE_INVALID (liste vide) ; LINK_TYPE_IN_USE quand des liens existants du type ' +
        "(tous les repos du workspace) ne seraient plus acceptés dans aucun sens — IDs cités, à supprimer d'abord " +
        '(delete_links). Réponse : le type de lien modifié.',
      inputSchema: updateLinkTypeInput,
    },
    async (dto) => {
      requireSomeChange('update_link_type', dto, ['labelSourceToTarget', 'labelTargetToSource', 'defaultVisible', 'sourceRefs', 'targetRefs'])
      freshenObjectIndexes(container)
      return runSchemaMutation(() => container.schema.updateLinkType(container.repoPath, dto, (next) => linksBrokenBy(container, next)))
    },
  )

  server.registerTool(
    'update_object_type',
    {
      title: 'Update object type',
      description:
        "Modifie un type d'objet existant : `label`, `color`, `displayIdField` (champ affiché à la place de l'ID " +
        "dans les liens : `title` ou un champ text / number / enum du type, sinon DISPLAY_ID_FIELD_INVALID), " +
        '`trackStatusHistory` (false : statut non historisé, refusé sur le type validation ; l\'historique existant ' +
        'reste). `null` retire la clé. Nom, préfixe et catégorie ne se modifient pas ici.',
      inputSchema: updateObjectTypeInput,
    },
    async (dto) => {
      requireSomeChange('update_object_type', dto, ['label', 'color', 'displayIdField', 'trackStatusHistory'])
      return runSchemaMutation(() => container.schema.updateObjectType(container.repoPath, dto))
    },
  )
}
