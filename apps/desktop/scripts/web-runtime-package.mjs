// GH44 S4 — manifeste des dépendances d'exécution du serveur web (image Docker) : uniquement les
// modules laissés externes par le bundle (scripts/build-web-server.ts), aux versions exactement
// installées dans le monorepo. Écrit sur la sortie standard.
//
//   node scripts/web-runtime-package.mjs > out/web-server-runtime/package.json
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))

// Déclarés en devDependencies : propres au serveur web, ils ne doivent pas entrer dans l'installeur
// du desktop (electron-builder y embarque toutes les `dependencies`).
const external = (name) => name === 'fastify' || name.startsWith('@fastify/') || name === 'playwright-core'
const dependencies = {}
for (const name of Object.keys(pkg.devDependencies).filter(external).sort()) {
  dependencies[name] = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf-8')).version
}

process.stdout.write(JSON.stringify({
  name: '@polenta/web-server-runtime',
  version: pkg.version,
  private: true,
  license: pkg.license,
  dependencies,
}, null, 2) + '\n')
