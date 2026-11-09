import * as fs from 'fs'
import git from 'isomorphic-git'
import type { MergeDriverCallback, MergeResult } from 'isomorphic-git'

/**
 * GH332 — fusion de deux commits qui ont plusieurs ancêtres communs (« fusion croisée » : les deux
 * branches se sont mutuellement fusionnées depuis leur dernier point commun).
 *
 * isomorphic-git ne connaît pas la stratégie récursive de git : `git.merge` lève alors
 * `MergeNotSupportedError` (« Merges with conflicts are not supported yet »), sans rien fusionner.
 * Pas de git CLI sur les postes : on reproduit la stratégie récursive au-dessus d'isomorphic-git.
 *
 * - Base virtuelle : les ancêtres communs sont fusionnés deux à deux (récursivement, s'ils ont
 *   eux-mêmes plusieurs ancêtres communs) en un commit non référencé. Un fichier en conflit entre
 *   ancêtres y garde la version de *leur* ancêtre commun : la fusion finale verra les deux côtés
 *   modifiés par rapport à elle et remontera le conflit à l'utilisateur au lieu de trancher.
 *   Un conflit que cette fusion ne sait pas exprimer (suppression d'un côté, modification de
 *   l'autre…) fait retomber sur cet ancêtre plus ancien lui-même — toujours un ancêtre commun valide.
 * - Fusion sur une base choisie : `git.merge` ne prend pas de base en paramètre ; on lui donne deux
 *   commits temporaires (arbre de chaque côté, seul parent : la base voulue), dont l'unique ancêtre
 *   commun est donc cette base. L'arbre obtenu est ensuite commité avec les vrais parents.
 *
 * Un conflit réel lève le `MergeConflictError` habituel (liste des fichiers) : les appelants le
 * traitent comme avant (éditeur de fusion, GH37).
 */

type Author = { name: string; email: string }

interface MergeArgs {
  dir: string
  /** Branche (ou oid) qui reçoit la fusion. */
  ours: string
  theirs: string
  author: Author
  message?: string
  dryRun?: boolean
  fastForwardOnly?: boolean
}

/** Drop-in pour `git.merge` (abortOnConflict) qui sait fusionner une histoire croisée. */
export async function mergeRecursive(args: MergeArgs): Promise<MergeResult> {
  const { dir, ours, theirs, author, message, dryRun, fastForwardOnly } = args
  const [ourOid, theirOid] = await Promise.all([
    git.resolveRef({ fs, dir, ref: ours }),
    git.resolveRef({ fs, dir, ref: theirs }),
  ])
  const bases = await git.findMergeBase({ fs, dir, oids: [ourOid, theirOid] })
  if (bases.length <= 1) {
    return git.merge({ fs, dir, ours, theirs, author, message, dryRun, fastForwardOnly })
  }
  // Plusieurs ancêtres communs : aucune des deux branches ne contient l'autre.
  if (fastForwardOnly) throw new git.Errors.FastForwardError()

  const base = await virtualBase(dir, bases as string[], author)
  const tree = await mergeTreesOnBase(dir, ourOid, theirOid, base, author)
  if (dryRun) return { tree, mergeCommit: true }
  const oid = await git.commit({
    fs, dir, author, tree,
    message: message ?? `Merge branch '${shortRef(theirs)}' into ${shortRef(ours)}`,
    parent: [ourOid, theirOid],
    noUpdateBranch: true,
  })
  if (!/^[0-9a-f]{40}$/.test(ours)) {
    const fullRef = ours.startsWith('refs/') ? ours : `refs/heads/${ours}`
    await git.writeRef({ fs, dir, ref: fullRef, value: oid, force: true })
  }
  return { oid, tree, mergeCommit: true }
}

/**
 * Un ancêtre commun unique de `a` et `b` : le vrai s'il est seul, sinon une base virtuelle.
 * `null` si les historiques n'ont rien en commun.
 */
export async function singleMergeBase(dir: string, a: string, b: string, author: Author): Promise<string | null> {
  const bases = await git.findMergeBase({ fs, dir, oids: [a, b] })
  if (bases.length === 0) return null
  return bases.length === 1 ? bases[0] as string : virtualBase(dir, bases as string[], author)
}

async function virtualBase(dir: string, bases: string[], author: Author): Promise<string> {
  let acc = bases[0]
  for (const next of bases.slice(1)) {
    const inner = await singleMergeBase(dir, acc, next, author)
    if (inner === null) continue // ancêtres sans historique commun : on garde le premier
    let tree: string
    try {
      tree = await mergeTreesOnBase(dir, acc, next, inner, author, keepAncestorOnConflict)
    } catch (err: unknown) {
      if (!(err instanceof git.Errors.MergeConflictError) && !(err instanceof git.Errors.MergeNotSupportedError)) throw err
      acc = inner
      continue
    }
    acc = await git.commit({
      fs, dir, author, tree, message: 'virtual merge base', parent: [acc, next], noUpdateBranch: true,
    })
  }
  return acc
}

/** Conflit de contenu dans la base virtuelle : la version de l'ancêtre commun (vide si ajout). */
const keepAncestorOnConflict: MergeDriverCallback = ({ contents }) => {
  const [base, ours, theirs] = contents
  if (ours === theirs) return { cleanMerge: true, mergedText: ours }
  return { cleanMerge: true, mergedText: base ?? '' }
}

/** Fusion à trois de `a` et `b` sur la base `base` ; renvoie l'oid de l'arbre résultat. */
async function mergeTreesOnBase(
  dir: string, a: string, b: string, base: string, author: Author, mergeDriver?: MergeDriverCallback,
): Promise<string> {
  const onBase = async (oid: string) => {
    const { commit } = await git.readCommit({ fs, dir, oid })
    return git.commit({ fs, dir, author, tree: commit.tree, parent: [base], message: 'merge side', noUpdateBranch: true })
  }
  const [sideA, sideB] = await Promise.all([onBase(a), onBase(b)])
  const result = await git.merge({
    fs, dir, ours: sideA, theirs: sideB, author, noUpdateBranch: true, abortOnConflict: true, mergeDriver,
  })
  if (result.tree) return result.tree
  // Fast-forward / déjà fusionné (un côté identique à la base) : l'arbre est celui du commit retenu.
  return (await git.readCommit({ fs, dir, oid: result.oid! })).commit.tree
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes)\//, '')
}
