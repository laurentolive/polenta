import type { Session } from './session'

/**
 * GH278 — la démo déclare ses types version, issue et validation, et un repo n'a qu'un type version et
 * qu'un type validation : une spec réutilise celui de la démo, et n'ajoute le sien qu'à défaut.
 * Renvoie le nom du type retenu.
 */
export function typeOfCategory<T extends { name: string; category: string }>(
  root: { objectTypes?: T[] }, category: string, fallback: T,
): string {
  const existing = (root.objectTypes ?? []).find(t => t.category === category)
  if (existing) return existing.name
  root.objectTypes = [...(root.objectTypes ?? []), fallback]
  return fallback.name
}

/**
 * GH202 — dès qu'un repo déclare une version sélectionnable, une exécution de campagne exige la version
 * testée : la première version en cours du repo, s'il y en a une.
 */
export async function testedVersionArg(s: Session): Promise<{ testedVersion?: { version: string } }> {
  const versions = await s.invoke<Array<{ id: string; status: string }>>('versions:list', s.project.localPath)
  const open = versions.find(v => v.status === 'en_cours')
  return open ? { testedVersion: { version: open.id } } : {}
}
