import type { SchemaStatus } from './schema'
import type { ValidationDecisionDef } from './validation'

/**
 * GH377 — valeurs par défaut d'un type version / validation, partagées par l'éditeur
 * (`objectTypeEditor.tsx`, `emptyObjType`) et le serveur MCP (`add_object_type`). Toujours copier
 * avant usage : ces tableaux ne doivent jamais se retrouver tels quels dans un schéma.
 */

/** GH201 — cycle de vie par défaut d'une version : released (`isApproval`) pose le tag et fige. */
export const DEFAULT_VERSION_STATUSES: readonly SchemaStatus[] = [
  { name: 'en_cours', label: 'En cours', color: '#2563eb' },
  { name: 'released', label: 'Released', color: '#16a34a', isApproval: true },
  { name: 'abandonnee', label: 'Abandonnée', color: '#6b7280', isTerminal: true },
]

/** GH204 — cycle de vie d'une validation : `signee` (`isApproval`) est le feu vert, `annulee` en sort. */
export const DEFAULT_VALIDATION_STATUSES: readonly SchemaStatus[] = [
  { name: 'en_cours', label: 'En cours', color: '#2563eb' },
  { name: 'signee', label: 'Signée', color: '#16a34a', isApproval: true },
  { name: 'annulee', label: 'Annulée', color: '#6b7280', isTerminal: true },
]

/** GH204 — jeu de décisions par défaut (MILESTONE-D §5.1). */
export const DEFAULT_VALIDATION_DECISIONS: readonly ValidationDecisionDef[] = [
  { name: 'en_attente', label: 'En attente', isPending: true },
  { name: 'conforme', label: 'Conforme' },
  { name: 'non_conforme', label: 'Non conforme', proposesIssue: true },
  { name: 'hors_scope', label: 'Hors scope' },
  { name: 'derogation', label: 'Dérogation', proposesIssue: true },
]
