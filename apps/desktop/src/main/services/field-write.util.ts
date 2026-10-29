import { prepareFieldsWrite } from '@polenta/types'
import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import type { GitService } from './git.service'
import { findObjectTypeDef } from './schema-lookup.util'

/**
 * Type d'un objet : dans le schéma du repo ouvert, sinon (nœud submodule sans `objectTypes`) dans
 * celui du repo propriétaire, par nom de type. Lu sur disque à chaque écriture : un processus long
 * (serveur MCP) voit le schéma enregistré par l'application. Introuvable : null.
 */
export async function readOwnedTypeDef(
  git: Pick<GitService, 'readYaml'>, repoPath: string, objectTypeRef: string | undefined, ownerRepo?: string,
): Promise<ObjectTypeDefinition | null> {
  if (!objectTypeRef) return null
  const resolve = async (repo: string, ref: string) => {
    const schema = await git.readYaml<ProjectSchema>(repo, '.polenta/schema.yaml').catch(() => null)
    const resolved = schema ? findObjectTypeDef(schema, ref) : null
    return resolved && resolved !== 'unresolvable' ? resolved : null
  }
  const own = await resolve(repoPath, objectTypeRef)
  if (own || !ownerRepo || ownerRepo === repoPath) return own
  return resolve(ownerRepo, objectTypeRef.split('::').pop() ?? objectTypeRef)
}

/** GH195 — écriture refusée par un champ : URL de lien invalide, `requiredWhen` non satisfait. */
export class FieldWriteError extends Error {
  constructor(readonly field: string, message: string) {
    super(message)
    this.name = 'FieldWriteError'
  }
}

interface WritableObject {
  objectTypeRef?: string
  status?: string
  fields?: Record<string, unknown>
}

/**
 * GH195 — contrôle commun des `persist()` (design §1) : normalise les champs `link` modifiés et
 * contrôle les `requiredWhen` touchés. Renvoie `after` avec ses `fields` normalisés ; lève
 * `FieldWriteError` sinon. Type introuvable : `after` inchangé.
 */
export async function applyFieldsWrite<T extends WritableObject>(
  git: Pick<GitService, 'readYaml'>, repoPath: string, before: WritableObject | null, after: T, ownerRepo?: string,
): Promise<T> {
  const typeDef = await readOwnedTypeDef(git, repoPath, after.objectTypeRef, ownerRepo)
  const result = prepareFieldsWrite(typeDef, before, after)
  if (!result.ok) throw new FieldWriteError(result.field, result.reason)
  return { ...after, fields: result.fields }
}
