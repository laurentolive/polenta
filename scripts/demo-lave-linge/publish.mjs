#!/usr/bin/env node
// GH278 — republie un workspace généré vers les 5 dépôts publics `demo-ll800-*`.
//
// Régénérer change tous les SHA : la publication remplace l'historique distant (force-push). Avant
// cela, l'ancienne tête de `main` de chaque dépôt est gardée sous le tag `archive/<SHA>`.
//
// Usage : node scripts/demo-lave-linge/publish.mjs --from <workspace généré> [--yes]
//   sans --yes : affiche les commandes, n'envoie rien.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { REPOS, REPO_ORDER, repoUrl } from './content.mjs'

const args = process.argv.slice(2)
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null
const YES = args.includes('--yes')
if (!from || !fs.existsSync(path.join(from, '.polenta', 'workspace.yaml'))) {
  console.error('--from <workspace généré> attendu (dossier contenant .polenta/workspace.yaml).')
  process.exit(1)
}
const run = (dir, cmd) => {
  console.log(`[${path.basename(dir)}] git ${cmd.join(' ')}`)
  if (YES) execFileSync('git', cmd, { cwd: dir, stdio: 'inherit' })
}
const read = (dir, cmd) => execFileSync('git', cmd, { cwd: dir, encoding: 'utf-8' }).trim()

// Feuilles d'abord, comme la génération : le produit épingle le SHA du module Wi-Fi.
for (const key of REPO_ORDER) {
  const dir = path.resolve(from, REPOS[key].dir)
  const url = repoUrl(key)
  if (read(dir, ['remote', 'get-url', 'origin']) !== url) throw new Error(`${dir} : remote inattendu`)
  const remoteMain = read(dir, ['ls-remote', url, 'refs/heads/main']).split(/\s/)[0]
  // Un tag par tête archivée : republier le même jour ne le réécrit pas et ne bloque pas la boucle.
  const archive = `archive/${remoteMain.slice(0, 12)}`
  if (remoteMain && !read(dir, ['ls-remote', '--tags', url, `refs/tags/${archive}`])) {
    run(dir, ['fetch', '--no-tags', url, `+refs/heads/main:refs/remotes/archive/main`])
    run(dir, ['push', url, `refs/remotes/archive/main:refs/tags/${archive}`])
  }
  const branches = read(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean)
  run(dir, ['push', '--force', url, ...branches.map(b => `+refs/heads/${b}:refs/heads/${b}`)])
  const tags = read(dir, ['tag']).split('\n').filter(t => t && !t.startsWith('archive/'))
  run(dir, ['push', '--force', url, ...tags.map(t => `+refs/tags/${t}:refs/tags/${t}`)])
}
console.log(YES ? 'Publication terminée.' : 'Rien envoyé : relancer avec --yes pour publier.')
