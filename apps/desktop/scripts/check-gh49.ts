/**
 * GH49 — vérifications automatiques de la marque blanche (specs/GH49-tests.md, scénarios « Auto »).
 * Sprint 1 : chargement/validation des marques (B*), configuration electron-builder (P1, P2, L6),
 * marque non injectée (B10), marque injectée dans le bundle MCP (P5, si `out/mcp-server/index.cjs`
 * existe). Sprint 2 : surcharges de thème (L5, D4), scan « aucun Polenta visible » (S1–S3).
 *
 * Lancement : `pnpm --filter @polenta/desktop exec tsx scripts/check-gh49.ts`
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { BRANDS_ROOT, BrandError, loadBrand, resolveBrandId } from './brand'
import { artifactBaseName, builderConfig } from '../electron-builder.config'
import { brandThemeCss } from './vite-brand-plugin'
import { buildAgentsMdTemplate } from '../src/main/services/agents-md.template'
import { themeTokens } from '../src/renderer/theme.config'

let failures = 0
let passes = 0

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passes++
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
}

function expectBrandError(name: string, fn: () => unknown, messagePart: string): void {
  try {
    fn()
    check(name, false, 'aucune erreur levée')
  } catch (err) {
    const ok = err instanceof BrandError && err.message.includes(messagePart)
    check(name, ok, err instanceof Error ? err.message : String(err))
  }
}

// ─── B1/B2 : marques livrées ────────────────────────────────────────────────────────────────
console.log('Marques livrées')
check('B1 défaut = polenta', resolveBrandId({}) === 'polenta')
check('B1 POLENTA_BRAND vide = polenta', resolveBrandId({ POLENTA_BRAND: '  ' }) === 'polenta')
const polenta = loadBrand('polenta')
check('B1 polenta : valeurs historiques', JSON.stringify(polenta.info) === JSON.stringify({
  id: 'polenta',
  productName: 'Polenta',
  appId: 'com.polenta.desktop',
  executableName: 'polenta',
  website: 'https://polenta.dev',
  update: { provider: 'github', owner: 'laurentolive', repo: 'polenta' },
  releasesUrl: 'https://github.com/laurentolive/polenta/releases',
  hasLogo: false,
}), polenta.info)
check('B1 polenta : favicon dédié', polenta.faviconPath.endsWith('favicon.svg'))
check('B1 polenta : pas de surcharge de thème', Object.keys(polenta.theme).length === 0)
const demo = loadBrand('demo')
check('B2 demo : sans update ni releasesUrl', !demo.info.update && !demo.info.releasesUrl)
check('B2 demo : logo', demo.info.hasLogo && !!demo.logoPath)
check('B2 demo : thème prim', demo.theme['prim']?.light === '217 95 2')

// ─── B3–B9 : marques invalides (copies de demo altérées dans un dossier temporaire) ──────────
console.log('Marques invalides')
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'gh49-brands-'))
function variant(id: string, yamlText: string | null, removeFile?: string): void {
  const dir = path.join(tmpRoot, id)
  cpSync(path.join(BRANDS_ROOT, 'demo'), dir, { recursive: true })
  if (yamlText !== null) writeFileSync(path.join(dir, 'brand.yaml'), yamlText, 'utf8')
  if (removeFile) unlinkSync(path.join(dir, removeFile))
}
const base = (id: string, extra = '') => `id: ${id}\nproductName: X\nappId: com.x.y\n${extra}`
try {
  expectBrandError('B3 marque inconnue', () => loadBrand('inconnue', tmpRoot), 'introuvable')
  expectBrandError('B3 identifiant invalide', () => loadBrand('Acme Corp', tmpRoot), 'identifiant de marque invalide')
  variant('noname', 'id: noname\nappId: com.x.y\n')
  expectBrandError('B4 productName manquant', () => loadBrand('noname', tmpRoot), 'productName')
  variant('noappid', 'id: noappid\nproductName: X\n')
  expectBrandError('B4 appId manquant', () => loadBrand('noappid', tmpRoot), 'appId')
  variant('mismatch', base('autre'))
  expectBrandError('B5 id ≠ dossier', () => loadBrand('mismatch', tmpRoot), 'différent du nom du dossier')
  variant('badname', base('badname').replace('productName: X', 'productName: "Acme: Specs/Pro"'))
  expectBrandError('B4 productName avec caractères interdits', () => loadBrand('badname', tmpRoot), 'nom de fichier')
  variant('accent', base('accent').replace('productName: X', `productName: "L'Outil Été"`))
  check('L6 productName accentué accepté', loadBrand('accent', tmpRoot).info.productName === "L'Outil Été")
  variant('badexe', base('badexe', 'executableName: Mon App\n'))
  expectBrandError('B5 executableName invalide', () => loadBrand('badexe', tmpRoot), 'executableName')
  variant('noicon', base('noicon'), 'icon.ico')
  expectBrandError('B6 icône manquante', () => loadBrand('noicon', tmpRoot), 'icon.ico')
  variant('badtoken', base('badtoken', "theme:\n  couleur-inexistante: { light: '1 2 3' }\n"))
  expectBrandError('B7 token inconnu', () => loadBrand('badtoken', tmpRoot), 'token inconnu')
  variant('badrgb', base('badrgb', "theme:\n  prim: { light: '300 0 0' }\n"))
  expectBrandError('B8 triplet hors bornes', () => loadBrand('badrgb', tmpRoot), 'triplet RGB invalide')
  variant('badrgb2', base('badrgb2', "theme:\n  prim: { light: '#ff0000' }\n"))
  expectBrandError('B8 triplet hexadécimal', () => loadBrand('badrgb2', tmpRoot), 'triplet RGB invalide')
  variant('badprovider', base('badprovider', 'update:\n  provider: ftp\n'))
  expectBrandError('B9 provider inconnu', () => loadBrand('badprovider', tmpRoot), 'update.provider')
  variant('norepo', base('norepo', 'update:\n  provider: github\n  owner: acme\n'))
  expectBrandError('B9 github sans repo', () => loadBrand('norepo', tmpRoot), 'update.repo')
  variant('generic', base('generic', 'update:\n  provider: generic\n  url: https://u.example/acme\n'))
  const generic = loadBrand('generic', tmpRoot)
  check('L7 generic sans releasesUrl → pas de lien', generic.info.update?.provider === 'generic' && !generic.info.releasesUrl)
  variant('nologo', base('nologo'), 'logo.svg')
  check('L4 sans logo.svg → hasLogo false', !loadBrand('nologo', tmpRoot).info.hasLogo)
  variant('nofavicon', base('nofavicon'))
  check('favicon absent → icon.svg', loadBrand('nofavicon', tmpRoot).faviconPath.endsWith('icon.svg'))
} finally {
  rmSync(tmpRoot, { recursive: true, force: true })
}

// ─── P1/P2/L6 : configuration electron-builder ──────────────────────────────────────────────
console.log('Configuration electron-builder')
const pc = builderConfig(polenta)
check('P1 appId', pc.appId === 'com.polenta.desktop')
check('P1 productName', pc.productName === 'Polenta')
check('P1 extraMetadata.name', (pc.extraMetadata as { name?: string })?.name === 'polenta')
check('P1 artifactName', pc.win && typeof pc.win === 'object' && pc.win.artifactName === 'Polenta-Setup-${version}.${ext}', pc.win)
check('P1 shortcutName', pc.nsis?.shortcutName === 'Polenta')
check('P1 publish github', JSON.stringify(pc.publish) === JSON.stringify({ provider: 'github', owner: 'laurentolive', repo: 'polenta', releaseType: 'release' }), pc.publish)
check('P1 icône win', typeof pc.win?.icon === 'string' && pc.win.icon.endsWith(path.join('brands', 'polenta', 'icon.ico')))
check('P1 buildResources', pc.directories?.buildResources === path.join('brands', 'polenta'), pc.directories)
const dc = builderConfig(demo)
check('P2 artifactName demo', dc.win?.artifactName === 'Demo-Specs-Setup-${version}.${ext}', dc.win?.artifactName)
check('P2 shortcutName demo', dc.nsis?.shortcutName === 'Demo Specs')
check('P2 publish null', dc.publish === null)
check('P2 extraMetadata.name demo', (dc.extraMetadata as { name?: string })?.name === 'demo-specs')
check('P2 icône demo', typeof dc.win?.icon === 'string' && dc.win.icon.endsWith(path.join('brands', 'demo', 'icon.ico')))
check('L6 nom avec apostrophe/accent/espaces', artifactBaseName("  L'Outil   Été ") === 'L-Outil-Ete', artifactBaseName("  L'Outil   Été "))

// ─── B10 : module de marque chargé sans define ni register-brand ──────────────────────────────
console.log('Marque non injectée')
const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs')
const run = spawnSync(process.execPath, [tsxCli, path.resolve(__dirname, '../src/shared/brand.ts')], { encoding: 'utf8' })
check('B10 erreur explicite, pas de repli Polenta', run.status !== 0 && run.stderr.includes('marque non injectée'), run.stderr.slice(0, 300))

// ─── P5 : marque injectée dans le bundle MCP (si construit) ──────────────────────────────────
const mcpBundle = path.resolve(__dirname, '../out/mcp-server/index.cjs')
if (existsSync(mcpBundle)) {
  console.log('Bundle MCP')
  const brandId = resolveBrandId()
  check(`P5 bundle MCP porte la marque ${brandId}`, readFileSync(mcpBundle, 'utf8').includes(`appId: ${JSON.stringify(loadBrand(brandId).info.appId)}`))
} else {
  console.log('Bundle MCP absent (pnpm build:mcp-server) — P5 ignoré')
}

// ─── L5/D4 : surcharges de thème ─────────────────────────────────────────────────────────────
console.log('Thème')
check('L5 polenta : aucune règle CSS', brandThemeCss(polenta) === '')
const demoCss = brandThemeCss(demo)
check('D4 demo : prim clair', demoCss.includes('html:root { --prim: 217 95 2;'), demoCss)
check('D4 demo : prim sombre', /html\.dark \{ --prim: 251 146 60;/.test(demoCss), demoCss)
check('D4 demo : tokens non surchargés absents', !demoCss.includes('--canvas'))
const partial = brandThemeCss({ ...demo, theme: { prim: { light: '1 2 3' } } })
check('D4 surcharge clair seul : sombre = valeur Polenta', partial.includes(`html.dark { --prim: ${themeTokens['prim'].dark};`), partial)

// ─── S1–S3 : aucun « Polenta » visible ────────────────────────────────────────────────────────
console.log('Aucun Polenta visible')
const srcRoot = path.resolve(__dirname, '../src')
// Noms de fichiers / variables de format conservés (spec §2) : cités tels quels pour être trouvés.
const FORMAT_NAMES_RE = /\.polenta\/|polenta-repo\.yaml|polenta:agents-md-version|POLENTA_\w+/g
for (const loc of ['fr', 'en']) {
  const offenders: string[] = []
  const walk = (node: unknown, key: string): void => {
    if (typeof node === 'string') { if (/polenta/i.test(node.replace(FORMAT_NAMES_RE, ''))) offenders.push(key) }
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, key ? `${key}.${k}` : k)
  }
  walk(JSON.parse(readFileSync(path.join(srcRoot, `renderer/i18n/locales/${loc}.json`), 'utf8')), '')
  check(`S1 ${loc}.json sans « Polenta »`, offenders.length === 0, offenders)
}
// Identifiants de format conservés (spec §2) : types/classes Polenta*, et le mot dans les commentaires.
const FORMAT_IDENTIFIER_RE = /\bPolenta(Repo|Workspace|Api)\w*/g
const COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)/
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|html)$/.test(name) && name !== 'routeTree.gen.ts' ? [full] : []
  })
}
const literalOffenders: string[] = []
for (const file of ['main', 'renderer', 'preload', 'mcp-server', 'shared'].flatMap(d => sourceFiles(path.join(srcRoot, d)))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (COMMENT_LINE_RE.test(line)) return
    const code = line.replace(/\s\/\/.*$/, '').replace(FORMAT_IDENTIFIER_RE, '')
    // Le mot, ou un lien vers le repo de Polenta (ex. ancienne liste blanche de pages de release).
    if (/\bPolenta\b|laurentolive\/polenta\b/.test(code)) literalOffenders.push(`${path.relative(srcRoot, file)}:${i + 1}`)
  })
}
check('S2 aucun « Polenta » dans le code (hors commentaires et identifiants de format)', literalOffenders.length === 0, literalOffenders)
const agentsDemo = buildAgentsMdTemplate({ productName: 'Demo Specs' })
const agentsResidue = agentsDemo.replace(FORMAT_NAMES_RE, '')
check('S3 AGENTS.md demo : « Polenta » seulement dans les noms de format', !/polenta/i.test(agentsResidue),
  agentsResidue.split('\n').filter(l => /polenta/i.test(l)))
check('S3 AGENTS.md demo : nom de la marque, sans lien', agentsDemo.includes('géré avec Demo Specs :'))
check('S3 AGENTS.md polenta : lien conservé', buildAgentsMdTemplate(polenta.info).includes('géré avec [Polenta](https://polenta.dev)'))

console.log(`\n${passes} ok, ${failures} échec(s)`)
process.exit(failures ? 1 : 0)
