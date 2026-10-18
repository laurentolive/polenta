import type { ExportTemplateKey } from './export'

export type SchemaFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'enum'
  | 'multi_enum'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'richtext'
  | 'user'
  | 'drawio'

export interface SchemaField {
  name: string
  label?: string
  type: SchemaFieldType
  values?: string[]          // enum / multi_enum only
  required?: boolean
  default?: unknown
  placeholder?: string
  validator?: string         // e.g. "EARS" | "regex:<pattern>"
  /** GH77 — historiser les changements de ce champ (`history.<name>`). Écrit seulement si vrai. */
  trackHistory?: boolean
}

// Format de stockage d'un champ `multi_enum` : chaîne CSV (ex. "a, b, c"), pas une liste
// YAML/JSON — cf. specs/T126.md. Ces deux fonctions centralisent le split/join, dupliqué
// avant T126 dans plusieurs endroits (renderer et main).
// `parseMultiEnumValue` accepte aussi un tableau déjà résolu : `fields` est un
// Record<string, unknown> non validé (specs/T126.md — pas de contrôle de type à l'écriture),
// un fichier édité à la main ou importé (T122, serveur MCP) peut donc contenir une vraie
// liste YAML plutôt que la chaîne CSV attendue — sans ce garde, `.split` sur un tableau
// lève une TypeError non rattrapée côté main process (interface-compliance.service.ts).
export function parseMultiEnumValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value !== 'string' || !value) return []
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

export function serializeMultiEnumValue(values: string[]): string {
  return values.join(', ')
}

// T110 sprint 3 — un champ multi_enum nommé `roles` source ses options depuis le catalogue de
// rôles du repo courant (`interfaceRoles`, dérivé de `ProjectSchema.roles`) quand ce catalogue est
// non vide, au lieu de `field.values` codées en dur. Spécialisation par nom de champ, pas un
// SchemaFieldType dédié (specs/T110-design.md). Centralisé ici (T126) — dupliqué 3 fois avant
// extraction (EditView.tsx/DynamicField.tsx via MultiEnumCheckboxes, ExcelView.tsx, WordView.tsx).
export function resolveMultiEnumOptions(field: Pick<SchemaField, 'name' | 'values'>, interfaceRoles?: string[]): string[] {
  return (field.name === 'roles' && interfaceRoles?.length) ? interfaceRoles : (field.values ?? [])
}

export interface SchemaStatus {
  name: string
  label?: string
  color?: string
  isApproval?: boolean
  isTerminal?: boolean       // masque l'objet des listes par défaut (ex: obsolete)
}

// Catégorie technique d'un type d'objet.
// Détermine les champs système implicites, le comportement sidebar et le workflow :
//   requirement — id, title, status (from statuses[]), fields{}
//   test        — id, title, status (from statuses[]), steps[], fields{}
//   campaign    — id, title, status fixe (planned/in_progress/completed/abandoned),
//                 testCaseIds[], runs[] — le champ statuses[] est ignoré pour cette catégorie
export type ObjectCategory = 'requirement' | 'test' | 'campaign'

// Définition d'un type d'objet dans un composant.
// Chaque définition est indépendante même si créée depuis le même template.
// fields[] = champs additionnels configurables (au-dessus des champs système implicites).
// Contrainte : prefix doit être unique sur l'ensemble du projet (tous composants confondus).
export interface ObjectTypeDefinition {
  name: string
  label?: string
  color?: string
  prefix?: string
  category: ObjectCategory
  fields: SchemaField[]
  statuses?: SchemaStatus[]
  /** GH77 — historiser le statut (`history.status`). Absent = true ; écrit seulement si false. */
  trackStatusHistory?: boolean
}

/** GH68 — `status` est-il le statut d'approbation du type (`statuses[].isApproval`) ? Repli sur
 *  le littéral `approved` quand le type est introuvable ou ne déclare aucun statut d'approbation
 *  (règle unique, partagée avec le critère 4 de maturité — GH80). */
export function isApprovalStatus(typeDef: Pick<ObjectTypeDefinition, 'statuses'> | null | undefined, status: string): boolean {
  const approvalStatusName = typeDef?.statuses?.find(s => s.isApproval)?.name
  return status === (approvalStatusName ?? 'approved')
}

// Noeud local : composant propre au repo produit.
//   objectTypes defini ici dans le schema produit.
// Un noeud peut reference un composant d'un autre repo dans le workspace plat
// (T69 : decouverte via polenta-repo.yaml, pas via url/branch).
//
// Un composant local (SystemNode) a les memes capacites qu'un composant en repo separe (T123) :
// il peut contenir d'autres composants locaux (children, profondeur non limitee) et
// exposer/implementer des interfaces (roles/implements) exactement comme le node `root` d'un
// repo interface/implementeur. Pas de distinction fonctionnelle "sous-composant" vs "composant"
// — seule la presence ou non d'un repo git separe (polenta-repo.yaml) differencie les deux.
export interface SystemNode {
  name: string
  label: string
  description?: string
  readonly: boolean
  objectTypes?: ObjectTypeDefinition[]
  /** Composants locaux imbriques sous celui-ci, profondeur non limitee (T123). */
  children?: SystemNode[]
  /** Roles exposes par ce composant s'il joue le role d'une interface (T123 — deplace depuis
   *  ProjectSchema.roles, qui ne portait cette information qu'au niveau du repo entier). */
  roles?: RoleDefinition[]
  /** Interfaces implementees par ce composant (T123 — deplace depuis ProjectSchema.implements). */
  implements?: ImplementsDeclaration[]
}

// ── Interface versioning (T69 Sprint 4) ───────────────────────────────────────

/**
 * Role definition for interface repos.
 * Declared in schema.yaml of the interface repo under `roles:`.
 * The interface is sovereign over its own role terminology
 * (controller/device, server/client, master/slave, etc.).
 */
export interface RoleDefinition {
  name: string
  label?: string
}

/**
 * Declaration made by a component repo to signal that it implements
 * a given interface, and which roles it plays. The implemented version
 * is not declared here — it is the git pin of the interface repo's mount
 * in the workspace (see WorkspaceTreeNode.pin), read at display time.
 * Declared in schema.yaml of the implementing component under `implements:`.
 */
export interface ImplementsDeclaration {
  /** Mount name of the interface repo in the workspace. */
  interface: string
  /** Roles this component plays for this interface. */
  roles: string[]
}

// Type de lien sémantique entre objets (requirements, tests, campagnes).
// Tout lien entre objets passe par ce mécanisme — il n'existe pas de système parallèle.
// sourceRefs / targetRefs : tableau de références, chaque élément est :
//   - une catégorie       : "requirement" | "test" | "campaign" → tout objet de cette catégorie
//   - une ref spécifique  : "componentName::objectName"         → type précis dans un composant
// Tableau vide = type de lien invalide, n'accepte rien (cas d'un type cible supprimé, GH104) :
// masqué des éditeurs (`isLinkTypeValid`, qui exige aussi les deux listes) et refusé par la
// validation du main (serveur MCP), pour qui une liste absente reste non contrainte.
export interface LinkTypeDefinition {
  name: string
  labelSourceToTarget: string
  labelTargetToSource: string
  sourceRefs?: string[]
  targetRefs?: string[]
}

// Project-level tool preferences — independent of the data model (nodes/objectTypes/linkTypes).
// Declared in schema.yaml under `preferences:`.
export interface ProjectPreferences {
  /**
   * If true, a sub-repo's pin is propagated automatically into the parent repo's manifest
   * when the sub-repo receives a commit. If false (default), propagation waits for manual
   * approval by the integrator. Decided 2026-07-14 — see CLAUDE.md "Modèle de données".
   */
  autoPropagatePin?: boolean
  /**
   * GH34 — gabarit d'export par défaut, par `<kind>:<format>` : chemin relatif à la bibliothèque
   * de gabarits de chaque utilisateur (préférence application `exportTemplatesDir`). Absent =
   * rendu Standard.
   */
  exportTemplates?: Partial<Record<ExportTemplateKey, string>>
  /**
   * GH65 — intervalle du pull automatique (minutes), lu dans le schéma du repo racine. Entier dans
   * [1, 60] ; absent ou invalide = 5.
   */
  autoPullIntervalMinutes?: number
}

export interface ProjectSchema {
  version: number
  nodes: SystemNode[]
  linkTypes: LinkTypeDefinition[]
  /**
   * @deprecated T123 — roles/implements vivent desormais sur SystemNode (root compris), pour
   * qu'un composant local ait la meme capacite d'interface qu'un composant en repo separe.
   * Toujours ecrit en parallele de `nodes[root].roles` pendant la transition (Sprint 1-3) :
   * plusieurs lecteurs (workspace-tree.service.ts, interface-compliance.service.ts, popup
   * d'edition de roles cote renderer) lisent encore ce champ directement, sans passer par
   * SchemaService. A retirer une fois ces lecteurs migres vers `nodes[root]` (cf. T123 sprint 3/4).
   */
  roles?: RoleDefinition[]
  /** @deprecated T123 — voir `roles` ci-dessus, meme transition vers `nodes[root].implements`. */
  implements?: ImplementsDeclaration[]
  /** Project-level tool preferences (per-repo, not global to all open projects). */
  preferences?: ProjectPreferences
}

// ── Tree data model ───────────────────────────────────────────────────────────

// A node in the element tree (either a folder or an item).
// Items reference an object (requirement, test, etc.) by its ID.
// Folders are purely structural grouping nodes.
export type TreeNodeKind = 'folder' | 'item'

export interface TypeTreeNode {
  id: string           // unique, immutable, auto-generated UUID
  kind: TreeNodeKind
  name: string         // display name (folder name or item title override)
  objectId?: string    // for kind='item': ID of the underlying object
  children: TypeTreeNode[]
}

// The full tree for a given (SystemNode, ObjectTypeDefinition) pair.
// Stored in .polenta/trees/{nodeName}/{typeName}.yaml
export interface TypeTree {
  nodeId: string       // SystemNode.name
  typeId: string       // ObjectTypeDefinition.name
  root: TypeTreeNode[]
}

/** GH100 — renommage d'un type d'objet (nom et/ou préfixe) avec migration de ses objets. */
export interface TypeRenameDto {
  nodeName: string
  category: 'requirement' | 'test' | 'campaign'
  oldName: string
  newName: string
  oldPrefix: string
  newPrefix: string
}

export interface TypeRenamePlan {
  /** IDs renommés (préfixe changé, types exigence / test) ; vide sinon. */
  objects: Array<{ oldId: string; newId: string }>
  /** Objets du type dont l'`objectTypeRef` change (nom changé). */
  retargeted: number
  /** Fichiers de données réécrits ou renommés, hors fichiers des objets du type. */
  files: Array<{ repoPath: string; path: string; newPath?: string }>
  /** Repos dont des refs `<nœud>::<type>` de `linkTypes` changent. */
  linkTypeRepos: string[]
  errors: Array<{ code: 'ID_COLLISION' | 'REPO_MISSING'; detail: string }>
}

/** GH104 — suppression en cascade d'un composant local (et de son sous-arbre) ou d'un type. */
export type SchemaDeleteTarget =
  | { kind: 'node'; nodeName: string }
  | { kind: 'type'; nodeName: string; typeName: string }

export interface SchemaDeletePlan {
  /** Nœuds supprimés (le nœud cible et ses descendants) ; vide pour un type. */
  nodes: string[]
  /** Refs `<nœud>::<type>` supprimées. */
  types: string[]
  /** IDs des objets supprimés (dans le repo du schéma), par catégorie. */
  objects: { requirement: string[]; test: string[]; campaign: string[] }
  /** Liens supprimés, par repo du workspace (repos sans lien touché absents). */
  links: Array<{ repoPath: string; count: number }>
  /** Types de lien dont des refs sont retirées ; `emptied` : `sourceRefs` ou `targetRefs` devient vide. */
  linkTypes: Array<{ repoPath: string; name: string; emptied: boolean }>
  errors: Array<{ code: 'NOT_FOUND' | 'READONLY' | 'REPO_MISSING'; detail: string }>
}

export interface SchemaDeleteResult {
  deleted: string[]
  links: number
  /** `id` : ID d'objet, ou `<repo>:<chemin>` pour un autre fichier. */
  failed: Array<{ id: string; error: string }>
}
