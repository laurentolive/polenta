import * as fsP from 'fs/promises'
import * as path from 'path'
import { CONTENT_ARGS, ROOT_ARGS } from './channel-policy'

/**
 * GH44 — validation des arguments d'un appel RPC avant d'atteindre un handler
 * (specs/GH44-design.md §4.3). Les services prennent des chemins absolus et des identifiants qu'ils
 * joignent à ces chemins : tout ce qui pourrait désigner un fichier hors de l'espace de
 * l'utilisateur est refusé ici.
 *
 * 1. Argument texte de premier niveau (ou élément d'un tableau de premier niveau) : absolu → doit
 *    être sous la racine de l'utilisateur, liens symboliques résolus ; relatif → aucun segment
 *    `..`, pas de lecteur Windows. Exceptions : `CONTENT_ARGS` (texte libre). Les arguments
 *    « racine » (`ROOT_ARGS`) doivent en plus être absolus.
 *
 * Défense en profondeur : le serveur s'exécute depuis un dossier vide (`index.ts`), un chemin
 * relatif oublié ne désigne donc jamais ses propres fichiers.
 * 2. Objets (DTO), récursivement : seules les clés de chemin (`…Path`, `…Dir`, `path`) suivent la
 *    règle 1 ; les champs de contenu ne sont pas inspectés.
 * 3. Tout argument contenant un octet nul est refusé.
 */
export class PathGuardError extends Error {
  constructor(readonly argIndex: number, readonly reason: string) {
    super(`Argument ${argIndex} refusé : ${reason}`)
  }
}

const PATH_KEY = /(path|dir)$/i
const MAX_DEPTH = 32

function looksAbsolute(s: string): boolean {
  return path.isAbsolute(s) || path.win32.isAbsolute(s) || path.posix.isAbsolute(s)
}

/** Résout les liens symboliques du plus long préfixe existant de `p` (le reste n'existe pas encore). */
async function realpathLoose(p: string): Promise<string> {
  let existing = p
  const rest: string[] = []
  for (;;) {
    try {
      const real = await fsP.realpath(existing)
      return rest.length ? path.join(real, ...rest.reverse()) : real
    } catch {
      const parent = path.dirname(existing)
      if (parent === existing) return p
      rest.push(path.basename(existing))
      existing = parent
    }
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function checkPathString(s: string, realRoot: string, argIndex: number): Promise<void> {
  if (s.includes('\0')) throw new PathGuardError(argIndex, 'octet nul')
  if (looksAbsolute(s)) {
    // `path.resolve` normalise les `..` ; les liens symboliques sont résolus ensuite.
    const real = await realpathLoose(path.resolve(s))
    if (!isInside(realRoot, real)) throw new PathGuardError(argIndex, 'chemin hors de l\'espace utilisateur')
    return
  }
  if (/^[a-zA-Z]:/.test(s)) throw new PathGuardError(argIndex, 'lecteur Windows')
  if (s.split(/[\\/]/).includes('..')) throw new PathGuardError(argIndex, 'segment « .. »')
}

async function checkObject(value: unknown, realRoot: string, argIndex: number, depth: number): Promise<void> {
  if (depth > MAX_DEPTH) throw new PathGuardError(argIndex, 'structure trop profonde')
  if (Array.isArray(value)) {
    for (const item of value) await checkObject(item, realRoot, argIndex, depth + 1)
    return
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.includes('\0')) throw new PathGuardError(argIndex, 'octet nul')
    return
  }
  for (const [key, v] of Object.entries(value)) {
    if (PATH_KEY.test(key)) {
      if (typeof v === 'string') await checkPathString(v, realRoot, argIndex)
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'string') await checkPathString(item, realRoot, argIndex)
          else await checkObject(item, realRoot, argIndex, depth + 1)
        }
      } else await checkObject(v, realRoot, argIndex, depth + 1)
    } else {
      await checkObject(v, realRoot, argIndex, depth + 1)
    }
  }
}

/** `realRoot` : racine de l'utilisateur, déjà passée par `fs.realpath`. */
export async function checkArgs(channel: string, args: unknown[], realRoot: string): Promise<void> {
  const content = CONTENT_ARGS[channel] ?? []
  const roots = ROOT_ARGS[channel] ?? []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (roots.includes(i)) {
      const values = Array.isArray(arg) ? arg : [arg]
      for (const v of values) {
        if (v === undefined || v === null) continue
        if (typeof v !== 'string' || !looksAbsolute(v)) throw new PathGuardError(i, 'chemin absolu attendu')
      }
    }
    if (typeof arg === 'string') {
      if (content.includes(i)) {
        if (arg.includes('\0')) throw new PathGuardError(i, 'octet nul')
      } else {
        await checkPathString(arg, realRoot, i)
      }
    } else if (Array.isArray(arg)) {
      for (const item of arg) {
        if (typeof item === 'string') await checkPathString(item, realRoot, i)
        else await checkObject(item, realRoot, i, 1)
      }
    } else {
      await checkObject(arg, realRoot, i, 0)
    }
  }
}
