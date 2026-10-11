import * as fs from 'fs'
import * as path from 'path'
import { setGitRemoteGuard } from '../main/services/git-http'
import { BRAND } from '../shared/brand'

/**
 * GH44 — durcissements propres au process serveur (jamais appliqués au desktop) :
 *
 * - **Dossier courant vide** : un chemin relatif qui échapperait à la garde de chemins se résout
 *   dans un dossier sans contenu, jamais dans les sources ou les données du serveur.
 * - **Pas de liens symboliques** : un repo cloné peut contenir des liens (mode git 120000) que
 *   isomorphic-git recrée au checkout — un lien `images/x.png -> /etc/passwd` serait ensuite lu
 *   par `image:read`. Comme git avec `core.symlinks=false`, le lien devient un fichier texte
 *   contenant sa cible.
 * - **Hôtes git autorisés** : clones, fetch et push limités aux hôtes de la forge (SSRF).
 */
export interface HardeningOptions {
  dataDir: string
  gitHosts: string[]
  gitAllowHttp: boolean
}

export function disableSymlinks(): void {
  // Le module réel (pas un namespace ES, en lecture seule et parfois copié par le bundler) :
  // isomorphic-git lit `fs.promises.symlink` à chaque opération, le patch s'applique donc partout.
  const realFs = require('fs') as typeof fs
  const asText = (target: fs.PathLike) => String(target)
  realFs.symlinkSync = ((target: fs.PathLike, linkPath: fs.PathLike) =>
    realFs.writeFileSync(linkPath, asText(target))) as typeof fs.symlinkSync
  realFs.symlink = ((target: fs.PathLike, linkPath: fs.PathLike, ...rest: unknown[]) => {
    const cb = rest[rest.length - 1] as (err: NodeJS.ErrnoException | null) => void
    realFs.writeFile(linkPath, asText(target), err => cb(err))
  }) as typeof fs.symlink
  realFs.promises.symlink = (async (target: fs.PathLike, linkPath: fs.PathLike) => {
    await realFs.promises.writeFile(linkPath, asText(target))
  }) as typeof fs.promises.symlink
}

export function gitRemoteGuard(hosts: string[], allowHttp: boolean): (url: URL) => void {
  const allowed = new Set(hosts.map(h => h.toLowerCase()))
  return (url) => {
    const schemeOk = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
    if (!schemeOk || !allowed.has(url.hostname.toLowerCase())) {
      throw new Error(`Serveur git non autorisé sur ce serveur ${BRAND.productName} : ${url.protocol}//${url.host}`)
    }
  }
}

export function applyServerHardening(opts: HardeningOptions): void {
  const sandbox = path.join(opts.dataDir, '.cwd')
  fs.mkdirSync(sandbox, { recursive: true })
  process.chdir(sandbox)
  disableSymlinks()
  setGitRemoteGuard(gitRemoteGuard(opts.gitHosts, opts.gitAllowHttp))
}
