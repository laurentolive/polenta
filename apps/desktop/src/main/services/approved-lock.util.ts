import type { ObjectTypeDefinition } from '@polenta/types'

/** GH200 — écriture du contenu d'un élément approuvé sans réouverture. */
export class ApprovedLockedError extends Error {
  constructor(id: string) {
    super(`${id} est approuvé : rouvrez-le pour le modifier`)
    this.name = 'ApprovedLockedError'
  }
}

const isApproval = (typeDef: ObjectTypeDefinition | null, status: string) =>
  !!typeDef?.statuses?.find(s => s.name === status)?.isApproval

/**
 * GH200 §2 — le contenu d'un élément approuvé ne se modifie pas : refus si le statut est
 * `isApproval` avant **et** après l'écriture et qu'un champ de contenu change de valeur (un
 * formulaire qui renvoie tout le contenu inchangé passe). Une écriture qui fait aussi quitter
 * l'approbation est une réouverture : acceptée.
 */
export function assertContentEditable<T extends { id: string; status: string }>(
  typeDef: ObjectTypeDefinition | null, before: T, after: T, contentKeys: readonly (keyof T & string)[],
): void {
  if (!isApproval(typeDef, before.status) || !isApproval(typeDef, after.status)) return
  const same = (k: keyof T) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null)
  if (!contentKeys.every(same)) throw new ApprovedLockedError(before.id)
}

/**
 * GH243 §1 — règle de version unique : `version + 1` quand le statut **quitte** un statut
 * `isApproval` (réouverture, passage terminal…), inchangée sinon — quel que soit le chemin
 * (`openDraft`, transition, colonne Statut, MCP). Renvoie le champ à fusionner dans l'objet écrit :
 * vide quand la version ne change pas (aucune clé `version` ajoutée à un fichier qui n'en a pas).
 */
export function versionBump(
  typeDef: ObjectTypeDefinition | null, existing: { status: string; version?: number }, toStatus: string,
): { version?: number } {
  // Entre deux statuts `isApproval` (ex. approuvé → livré), l'élément ne quitte pas l'approbation.
  return isApproval(typeDef, existing.status) && !isApproval(typeDef, toStatus) ? { version: (existing.version ?? 0) + 1 } : {}
}
