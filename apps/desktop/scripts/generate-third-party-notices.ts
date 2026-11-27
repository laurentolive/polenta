/**
 * GH120 — mentions de licences des composants tiers livrés (THIRD-PARTY-NOTICES.txt).
 *
 * Le renderer est bundlé par Vite : les en-têtes de licence des dépendances bundlées disparaissent,
 * or MIT / BSD / ISC / Apache exigent que notice de copyright et texte de licence accompagnent toute
 * copie distribuée. Ce script les rassemble depuis les dépendances de production de
 * @polenta/desktop (`pnpm licenses list --prod`) et les fichiers vendorisés.
 *
 * Il échoue si une dépendance n'a pas de licence permissive connue (copyleft, licence absente) :
 * la diffusion de l'application sous une licence choisie par ses auteurs en dépend.
 *
 *   tsx scripts/generate-third-party-notices.ts [fichier de sortie]
 *   (défaut : out/notices/THIRD-PARTY-NOTICES.txt — repris par electron-builder dans extraResources)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface LicensedPackage {
  name: string
  versions: string[]
  paths: string[]
  license: string
  author?: string
  homepage?: string
}

/** Licences permissives acceptées (identifiants SPDX, tels que les rapporte pnpm). */
const PERMISSIVE = new Set([
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT',
  'MIT/X11', 'Python-2.0', 'Unlicense', 'WTFPL', 'Zlib',
])

/** Fichiers vendorisés hors npm : [composant, fichier de licence relatif à apps/desktop]. */
const VENDORED: Array<[string, string]> = [
  ['drawio-viewer.min.js (draw.io, Apache-2.0)', 'src/renderer/public/vendor/DRAWIO-VIEWER-LICENSE.txt'],
  // GH46 — éditeur draw.io embarqué (web) : licence de la webapp ; ses composants sont listés plus bas.
  ['draw.io webapp, éditeur embarqué v32.7.7 (Apache-2.0)', 'scripts/drawio-editor-LICENSE.txt'],
]

/**
 * GH46 — composants tiers livrés dans l'éditeur draw.io (`vendor/drawio-editor`, `pnpm drawio:fetch`),
 * avec leurs propres licences. Seulement si le fichier est présent (build web uniquement).
 */
const DRAWIO_EDITOR_BUNDLED: Array<[string, string]> = [
  ['libavoid (draw.io éditeur embarqué, LGPL-2.1)', 'vendor/drawio-editor/js/libavoid-js/LICENSE'],
  ['bibliothèques d’icônes et de formes draw.io (licence propre à draw.io)', 'vendor/drawio-editor/shapes/LICENSE'],
]

const root = path.resolve(__dirname, '..')
const output = path.resolve(root, process.argv[2] ?? 'out/notices/THIRD-PARTY-NOTICES.txt')

/** Licence retenue pour une expression SPDX : `(A OR B)` → la première option permissive ;
 * `(A AND B)` → toutes doivent l'être. null si aucune option n'est acceptable. */
function chosenLicense(expression: string): string | null {
  const options = expression.replace(/[()]/g, '').split(/\s+OR\s+/)
  return options.find((option) => option.split(/\s+AND\s+/).every((part) => PERMISSIVE.has(part.trim()))) ?? null
}

/** LICENSE*, LICENCE*, COPYING*, NOTICE* (Apache §4d) à la racine du paquet. */
function licenseFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(file))
    .sort()
    .map((file) => path.join(dir, file))
}

// Commande en une seule chaîne : pnpm est un .cmd sous Windows, lancé via le shell.
const result = spawnSync('pnpm licenses list --prod --json', {
  cwd: root,
  encoding: 'utf8',
  shell: true,
  maxBuffer: 64 * 1024 * 1024,
})
if (result.status !== 0) {
  console.error(`[notices] pnpm licenses list a échoué :\n${result.stderr}`)
  process.exit(1)
}

const packages = (Object.values(JSON.parse(result.stdout)) as LicensedPackage[][])
  .flat()
  .filter((pkg) => !pkg.name.startsWith('@polenta/'))
  .sort((a, b) => a.name.localeCompare(b.name))

const rejected = packages.filter((pkg) => chosenLicense(pkg.license) === null)
if (rejected.length > 0) {
  console.error('[notices] dépendances de production sans licence permissive acceptée :')
  for (const pkg of rejected) console.error(`  ${pkg.name}@${pkg.versions.join(',')} — ${pkg.license}`)
  process.exit(1)
}

const separator = '='.repeat(80)
const sections: string[] = [
  'THIRD-PARTY SOFTWARE NOTICES',
  '',
  'This application includes the third-party components listed below, each distributed under',
  'its own license. Electron and Chromium notices are provided separately in LICENSE.electron.txt',
  'and LICENSES.chromium.html, next to the application executable.',
]

for (const pkg of packages) {
  const license = chosenLicense(pkg.license)!
  const chosen = license !== pkg.license.replace(/[()]/g, '') ? ` (chosen from ${pkg.license})` : ''
  const header = [`${pkg.name} ${pkg.versions.join(', ')}`, `License: ${license}${chosen}`]
  if (pkg.author) header.push(`Author: ${pkg.author}`)
  if (pkg.homepage) header.push(`Homepage: ${pkg.homepage}`)
  const texts = [...new Set(pkg.paths.flatMap(licenseFiles))].map((file) => readFileSync(file, 'utf8').trim())
  sections.push(separator, header.join('\n'), '', texts.length > 0 ? texts.join('\n\n') : `(no license file shipped; ${license})`)
}

for (const [component, file] of VENDORED) {
  sections.push(separator, component, '', readFileSync(path.join(root, file), 'utf8').trim())
}

// GH46 — licences des composants inclus dans l'éditeur draw.io (présentes après `pnpm drawio:fetch`).
for (const [component, file] of DRAWIO_EDITOR_BUNDLED) {
  if (existsSync(path.join(root, file))) {
    sections.push(separator, component, '', readFileSync(path.join(root, file), 'utf8').trim())
  }
}

// GH337 — Git for Windows (PortableGit) embarqué sous Windows (`vendor/git`, `pnpm git:fetch`) :
// git et ses outils sont sous GPLv2, les bibliothèques MSYS2 sous LGPL et autres licences libres.
// La distribution de binaires oblige à offrir les sources : l'URL de la version fixée les donne.
// Seulement si `vendor/git` est présent (installation embarquée, pas le git Docker du serveur web).
if (existsSync(path.join(root, 'vendor/git'))) {
  const gitVersion = JSON.parse(readFileSync(path.join(root, 'scripts/git-version.json'), 'utf8')) as {
    version: string
    url: string
    sources: string
  }
  sections.push(
    separator,
    `Git for Windows (PortableGit) ${gitVersion.version}`,
    [
      'License: GPL-2.0-only (git and its tools); LGPL-2.1 and other free licenses (MSYS2 runtime, libraries,',
      'and bundled utilities such as ssh, bash, vim, less and perl). Each component keeps its own license',
      'and copyright notices, which are shipped with the Git for Windows release.',
      `Source code (exact version shipped): ${gitVersion.sources}`,
      `Download: ${gitVersion.url}`,
      'The complete corresponding source code of the distributed binaries is available at the source URL above.',
    ].join('\n'),
  )
}

mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, sections.join('\n\n') + '\n')
console.log(`[notices] ${packages.length} paquets + ${VENDORED.length} fichier(s) vendorisé(s) → ${path.relative(root, output)}`)
