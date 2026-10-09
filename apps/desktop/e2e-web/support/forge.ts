import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { E2E } from './env'

/**
 * Accès « hors application » à la forge locale des tests : relire l'historique d'un repo nu, ou
 * simuler un autre utilisateur qui pousse depuis son poste (git en ligne de commande) — utile pour
 * provoquer des conflits ou vérifier ce que Publier a envoyé.
 */
export const DEMO_REPO = 'demo-ll800-produit'

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

export function bareRepoPath(repo = DEMO_REPO): string {
  return path.join(E2E.remotesDir, `${repo}.git`)
}

/** `git log -1 --format=<format>` sur le repo nu (branche par défaut). */
export function remoteLog(format: string, repo = DEMO_REPO, ref = 'HEAD'): string {
  return git(['-C', bareRepoPath(repo), 'log', '-1', `--format=${format}`, ref])
}

/** Fichiers touchés par les `count` derniers commits du repo nu. */
export function remoteChangedFiles(count: number, repo = DEMO_REPO): string {
  return git(['-C', bareRepoPath(repo), 'log', `-${count}`, '--name-only', '--format='])
}

/** Tags du repo nu. */
export function remoteTags(repo = DEMO_REPO): string[] {
  return git(['-C', bareRepoPath(repo), 'tag', '--list']).split('\n').filter(Boolean)
}

/**
 * Un « autre utilisateur » : clone de travail en ligne de commande, hors de l'application. Les
 * modifications sont poussées avec `push()` ; l'identité des commits est celle passée ici.
 */
export function outsideClone(name: string, repo = DEMO_REPO, author = { name: 'Autre Utilisateur', email: 'autre@polenta.test' }) {
  const dir = path.join(E2E.root, 'outside', `${name}-${Date.now()}`)
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  git(['clone', '--quiet', `${E2E.gitBaseUrl}/${repo}.git`, dir])
  git(['config', 'user.name', author.name], dir)
  git(['config', 'user.email', author.email], dir)
  git(['config', 'core.autocrlf', 'false'], dir)
  return {
    dir,
    read(rel: string): string {
      return fs.readFileSync(path.join(dir, rel), 'utf-8')
    },
    write(rel: string, content: string): void {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), content)
    },
    /** Commit de tous les changements puis push sur la branche courante. */
    commitAndPush(message: string): string {
      git(['add', '-A'], dir)
      git(['commit', '--quiet', '-m', message], dir)
      git(['push', '--quiet', 'origin', 'HEAD'], dir)
      return git(['rev-parse', 'HEAD'], dir)
    },
  }
}
