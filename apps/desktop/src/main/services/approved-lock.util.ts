import type { ModificationKind, ObjectTypeDefinition } from '@polenta/types'

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
 * GH200 §3.1 — moment où l'élément devient modifiable lors d'un changement de statut : quitter un
 * statut `isApproval` (réouverture, ou passage terminal). `null` : rien à assigner.
 */
export function statusModificationKind(typeDef: ObjectTypeDefinition | null, before: string, after: string): ModificationKind | null {
  if (before === after || !isApproval(typeDef, before) || isApproval(typeDef, after)) return null
  return typeDef?.statuses?.find(s => s.name === after)?.isTerminal ? 'terminal' : 'reopen'
}
