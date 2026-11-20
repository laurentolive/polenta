import * as fs from 'fs'
import * as path from 'path'
import { setRemoteGuard as setGitRemoteGuard } from '../main/services/forge/remote-guard'
import { setAllowedGitProtocols } from '../main/git/git-config'
import { BRAND } from '../shared/brand'

/**
 * GH44 — durcissements propres au process serveur (jamais appliqués au desktop) :
 *
 * - **Dossier courant vide** : un chemin relatif qui échapperait à la garde de chemins se résout
 *   dans un dossier sans contenu, jamais dans les sources ou les données du serveur.
 * - **Pas de liens symboliques** : un repo cloné peut contenir des liens (mode git 120000) ; un lien
 *   `images/x.png -> /etc/passwd` serait ensuite lu par `image:read`. Le git embarqué ne les crée
 *   pas, car la config isolée pose `core.symlinks=false` (`git/git-config.ts`) : le lien devient un
 *   fichier texte contenant sa cible. Le patch de `fs.symlink` reste en filet pour le code de Polenta.
 * - **Protocoles et hôtes git autorisés** (GH337) : `GIT_ALLOW_PROTOCOL=https` (http seulement si
 *   `gitAllowHttp`) ; clones, fetch et push limités aux hôtes de la forge (SSRF), par la garde
 *   `setGitRemoteGuard` des appels réseau.
 *
 * Aucun moteur git n'est utilisé ici : toute opération git passe par `GitBackend`.
 */
export interface HardeningOptions {
  dataDir: string
  gitHosts: string[]
  gitAllowHttp: boolean
}

export function disableSymlinks(): void {
  // Le module réel (pas un namespace ES, en lecture seule et parfois copié par le bundler) :
  // le patch couvre tous les appels `fs.symlink` du processus, y compris ceux de Polenta.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- module CommonJS réel, voir ci-dessus
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
  setAllowedGitProtocols(opts.gitAllowHttp ? 'https:http' : 'https')
  setGitRemoteGuard(gitRemoteGuard(opts.gitHosts, opts.gitAllowHttp))
}
