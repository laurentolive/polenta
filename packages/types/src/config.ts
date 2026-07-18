// SUPERSEDED — remplacé par ProjectSchema dans schema.ts.
// À supprimer lors de l'implémentation une fois les consommateurs migrés.

export type FieldType =
  | 'TEXT'
  | 'RICHTEXT'
  | 'ENUM'
  | 'MULTI_ENUM'
  | 'DRAWIO'
  | 'NUMBER'
  | 'DATE'
  | 'DATETIME'
  | 'BOOLEAN'
  | 'USER'

export interface EnumOption {
  value: string
  label: string
  color?: string
  description?: string
}

export interface FieldDefinition {
  id: string
  label: string
  type: FieldType
  required: boolean
  readOnly: boolean
  order: number
  description?: string
  defaultValue?: unknown
  visibleInList: boolean
  visibleInDetail: boolean
  triggerVersionComment: boolean
  // Optional syntactic validator — defined in project template, not by Polenta core
  // Values: "EARS" | "regex:<pattern>" | undefined
  validator?: string
  // Type-specific params
  maxLength?: number
  regex?: string
  options?: EnumOption[]
  allowCustom?: boolean
  min?: number
  max?: number
  unit?: string
  decimals?: number
  labelTrue?: string
  labelFalse?: string
  multiSelect?: boolean
  allowImages?: boolean
  allowLinks?: boolean
  defaultTemplate?: string
  readOnlyForRoles?: string[]
}

export interface StatusDefinition {
  id: string
  label: string
  color: string
  isApproved: boolean
  isArchived: boolean
  isInitial: boolean
}

export interface TransitionDefinition {
  from: string | '*'
  to: string
  label: string
  requiredRoles: string[]
  requiresComment: boolean
  requiresReview: boolean
}

export interface RequirementTypeConfig {
  id: string
  name: string
  prefix: string
  color: string
  level: number
  parentTypes: string[]
  fields: FieldDefinition[]
  statuses: StatusDefinition[]
  transitions: TransitionDefinition[]
}

export interface ProjectConfig {
  requirementTypes: RequirementTypeConfig[]
}
