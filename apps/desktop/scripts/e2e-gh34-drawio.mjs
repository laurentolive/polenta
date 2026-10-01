// GH34 sprint 3 — vérification de bout en bout, dans l'app Electron buildée, de l'export Word à
// partir d'un gabarit avec diagramme draw.io : vraie fenêtre de capture (route
// /print/drawio-snapshot + capturePage), vrai gabarit d'exemple installé dans une bibliothèque.
// Profil utilisateur isolé ; le dialogue « Enregistrer sous » est remplacé dans le main.
//
// Prérequis : `pnpm --filter @polenta/desktop build`.
// Lancement : `node scripts/e2e-gh34-drawio.mjs [dossier-de-sortie]` (depuis apps/desktop) ;
// app packagée : `E2E_EXE=dist/win-unpacked/Polenta.exe node scripts/e2e-gh34-drawio.mjs`.
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gh34-e2e-'))
const outDir = process.argv[2] ?? path.join(work, 'out')
const repo = path.join(work, 'repo')
const lib = path.join(work, 'lib')
const userData = path.join(work, 'userdata')
for (const d of [outDir, path.join(repo, 'diagrams'), lib, userData]) fs.mkdirSync(d, { recursive: true })

// Diagramme non compressé : deux pages, la seconde ciblée par l'ancre, avec un rectangle et une flèche.
fs.writeFileSync(path.join(repo, 'diagrams', 'archi.drawio'), `<mxfile>
  <diagram id="page-1" name="Contexte"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="a" value="Page 1" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="60" as="geometry"/></mxCell>
  </root></mxGraphModel></diagram>
  <diagram id="page-2" name="Puissance"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="bms" value="BMS" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="160" height="80" as="geometry"/></mxCell>
    <mxCell id="mot" value="Driver moteur" style="rounded=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="320" y="40" width="160" height="80" as="geometry"/></mxCell>
    <mxCell id="e1" value="48 V" style="endArrow=classic;html=1;" edge="1" parent="1" source="bms" target="mot"><mxGeometry relative="1" as="geometry"/></mxCell>
  </root></mxGraphModel></diagram>
</mxfile>`)

const fence = (obj) => ['```drawio', JSON.stringify(obj), '```'].join('\n')
const statement = [
  'WHEN the pack voltage exceeds **4.25 V/cell**',
  'THE BMS SHALL open the charge FET within 10 ms',
  '',
  fence({ path: 'diagrams/archi.drawio', nodeId: 'page-2' }),
  '',
  fence({ path: 'diagrams/archi.drawio', nodeId: 'page-2', width: 240, height: 120 }),
  '',
  fence({ path: 'diagrams/absent.drawio' }),
].join('\n')
const payload = {
  componentLabel: 'BMS',
  columns: [
    { key: 'section', label: 'Section' }, { key: 'id', label: 'ID' }, { key: 'name', label: 'Label' },
    { key: 'status', label: 'Statut' }, { key: 'statement', label: 'Énoncé', type: 'richtext' },
  ],
  rows: [],
  outline: [
    { kind: 'folder', level: 1, section: '1', name: 'Sécurité batterie', values: {} },
    { kind: 'item', level: 2, section: '1.1', name: 'Surtension cellule', statusLabel: 'Approuvé',
      values: { section: '1.1', id: 'SYS-0001', name: 'Surtension cellule', status: 'approved', statement } },
  ],
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// `E2E_EXE` : exécutable de l'app packagée (ex. dist/win-unpacked/Polenta.exe, `electron-builder --dir`)
// au lieu du build de développement — vérifie ressources (`extraResources`) et chunks bundlés.
const packagedExe = process.env.E2E_EXE
const electronBin = packagedExe ?? path.join(APP_DIR, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const launchArgs = [...(packagedExe ? [] : [APP_DIR]), '--no-sandbox', `--user-data-dir=${userData}`]
const app = await electron.launch({ executablePath: electronBin, args: launchArgs, env, timeout: 30_000 })
let exitCode = 1
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const dest = path.join(outDir, 'e2e-drawio.docx')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, dest)
  const invoke = (...args) => page.evaluate(a => window.polenta.invoke(...a), args)

  await invoke('app:set-settings', { exportTemplatesDir: lib })
  const installed = await invoke('export-templates:install-examples')
  console.log('exemples installés :', JSON.stringify(installed))
  const list = await invoke('export-templates:list', 'docx')
  console.log('gabarits :', list.templates.map(t => t.relPath).join(', '))

  const t0 = Date.now()
  const result = await invoke('export:save', repo, 'requirements', 'docx', payload, undefined, 'x.docx', 'Exemples Polenta/Cahier des exigences.docx')
  console.log(`export (${Date.now() - t0} ms) :`, JSON.stringify(result))
  if (result.status === 'ok') {
    console.log('fichier :', dest, fs.statSync(dest).size, 'octets')
    exitCode = 0
  }
} finally {
  await app.close().catch(() => {})
}
process.exit(exitCode)
