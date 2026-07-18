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
}

export interface SchemaStatus {
  name: string
  label?: string
  color?: string
  isApproval?: boolean
  isTerminal?: boolean       // masque l'objet des listes par dÃ©faut (ex: obsolete)
}

// CatÃ©gorie technique d'un type d'objet.
// DÃ©termine les champs systÃ¨me implicites, le comportement sidebar et le workflow :
//   requirement â€” id, title, status (from statuses[]), fields{}
//   test        â€” id, title, status (from statuses[]), steps[], fields{}
//   campaign    â€” id, title, status fixe (planned/in_progress/completed/abandoned),
//                 testCaseIds[], runs[] â€” le champ statuses[] est ignorÃ© pour cette catÃ©gorie
export type ObjectCategory = 'requirement' | 'test' | 'campaign'

// DÃ©finition d'un type d'objet dans un composant.
// Chaque dÃ©finition est indÃ©pendante mÃªme si crÃ©Ã©e depuis le mÃªme template.
// fields[] = champs additionnels configurables (au-dessus des champs systÃ¨me implicites).
// Contrainte : prefix doit Ãªtre unique sur l'ensemble du projet (tous composants confondus).
export interface ObjectTypeDefinition {
  name: string
  label?: string
  color?: string
  prefix?: string
  category: ObjectCategory
  fields: SchemaField[]
  statuses?: SchemaStatus[]
}

// Noeud local : composant propre au repo produit.
//   objectTypes defini ici dans le schema produit.
// Un noeud peut reference un composant d'un autre repo dans le workspace plat
// (T69 : decouverte via polenta-repo.yaml, pas via url/branch).
export interface SystemNode {
  name: string
  label: string
  description?: string
  readonly: boolean
  objectTypes?: ObjectTypeDefinition[]
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

// Type de lien sÃ©mantique entre objets (requirements, tests, campagnes).
// Tout lien entre objets passe par ce mÃ©canisme â€” il n'existe pas de systÃ¨me parallÃ¨le.
// sourceRefs / targetRefs : tableau de rÃ©fÃ©rences, chaque Ã©lÃ©ment est :
//   - une catÃ©gorie       : "requirement" | "test" | "campaign" â†’ tout objet de cette catÃ©gorie
//   - une ref spÃ©cifique  : "componentName::objectName"         â†’ type prÃ©cis dans un composant
// Absent ou tableau vide = non contraint.
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
}

export interface ProjectSchema {
  version: number
  nodes: SystemNode[]
  linkTypes: LinkTypeDefinition[]
  /** Role declarations for interface repos (repos that expose a contract). */
  roles?: RoleDefinition[]
  /** Interface implementations declared by this component repo. */
  implements?: ImplementsDeclaration[]
  /** Project-level tool preferences (per-repo, not global to all open projects). */
  preferences?: ProjectPreferences
}

// â”€â”€ Tree data model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
