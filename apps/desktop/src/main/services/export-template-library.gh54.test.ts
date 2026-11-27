import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'
import PizZip from 'pizzip'
import { ExportTemplateLibrary } from './export-template-library'
import type { AppSettingsService } from './app-settings.service'

/** GH54 — bibliothèque personnelle de gabarits : ajout, remplacement, suppression, confinement. */

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

function zip(entries: Record<string, string>): Buffer {
  const z = new PizZip()
  for (const [name, content] of Object.entries(entries)) z.file(name, content)
  return z.generate({ type: 'nodebuffer' }) as Buffer
}
const DOCX = zip({ 'word/document.xml': '<w:document/>' })
const XLSX = zip({ 'xl/workbook.xml': '<workbook/>' })

describe('GH54 — ExportTemplateLibrary : gabarits envoyés', () => {
  let tmp: string
  let lib: string
  let src: string
  let library: ExportTemplateLibrary

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh54-'))
    lib = path.join(tmp, 'export-templates')
    src = path.join(tmp, 'envoi')
    fs.mkdirSync(src)
    const settings = { get: () => ({ exportTemplatesDir: lib }) } as unknown as AppSettingsService
    library = new ExportTemplateLibrary(settings)
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const upload = (_label: string, content: Buffer | string) => {
    const file = path.join(src, `${Math.random().toString(36).slice(2)}.upload`)
    fs.writeFileSync(file, content)
    return file
  }
  const onLib = (name: string) => fs.readFileSync(path.join(lib, name))

  describe('importFile', () => {
    it('copie un .docx valide à la racine de la bibliothèque, contenu identique', async () => {
      const r = await library.importFile('docx', upload('a.docx', DOCX), 'Cahier.docx', false)
      expect(r).toEqual({ status: 'ok', relPath: 'Cahier.docx' })
      expect(sha(onLib('Cahier.docx'))).toBe(sha(DOCX))
    })

    it('accepte un .xlsx valide (xl/workbook.xml)', async () => {
      const r = await library.importFile('xlsx', upload('a.xlsx', XLSX), 'Rapport.xlsx', false)
      expect(r.status).toBe('ok')
    })

    it('refuse un nom déjà présent sans rien écrire (D3)', async () => {
      await library.importFile('docx', upload('a.docx', DOCX), 'Cahier.docx', false)
      const other = zip({ 'word/document.xml': '<autre/>' })
      const r = await library.importFile('docx', upload('b.docx', other), 'Cahier.docx', false)
      expect(r).toEqual({ status: 'exists', relPath: 'Cahier.docx' })
      expect(sha(onLib('Cahier.docx'))).toBe(sha(DOCX))
    })

    it('remplace le contenu quand replace est vrai, sans fichier temporaire restant', async () => {
      await library.importFile('docx', upload('a.docx', DOCX), 'Cahier.docx', false)
      const other = zip({ 'word/document.xml': '<autre/>' })
      const r = await library.importFile('docx', upload('b.docx', other), 'Cahier.docx', true)
      expect(r.status).toBe('ok')
      expect(sha(onLib('Cahier.docx'))).toBe(sha(other))
      expect(fs.readdirSync(lib).filter(n => n.endsWith('.tmp'))).toEqual([])
    })

    it('refuse une archive sans word/document.xml, sans rien écrire', async () => {
      const bad = zip({ 'docProps/core.xml': '<core/>' })
      const r = await library.importFile('docx', upload('a.docx', bad), 'Faux.docx', false)
      expect(r.status).toBe('refused')
      expect(fs.existsSync(path.join(lib, 'Faux.docx'))).toBe(false)
    })

    it('refuse un fichier qui n’est pas une archive (texte renommé .docx)', async () => {
      const r = await library.importFile('docx', upload('a.docx', 'pas un zip'), 'Texte.docx', false)
      expect(r.status).toBe('refused')
      expect(fs.existsSync(path.join(lib, 'Texte.docx'))).toBe(false)
    })

    it('refuse un xlsx sans xl/workbook.xml, et un .docx envoyé pour le format xlsx', async () => {
      expect((await library.importFile('xlsx', upload('a.xlsx', DOCX), 'Mauvais.xlsx', false)).status).toBe('refused')
      expect((await library.importFile('xlsx', upload('a.docx', XLSX), 'Mauvais.docx', false)).status).toBe('refused')
    })

    it('refuse un nom avec dossier, parent, nom caché, verrou Office ou autre extension', async () => {
      for (const name of ['../x.docx', 'sous/x.docx', 'sous\\x.docx', '.cache.docx', '~$verrou.docx', 'x.pdf', '.docx', 'x']) {
        const r = await library.importFile('docx', upload('a.docx', DOCX), name, false)
        expect(r.status, name).toBe('refused')
      }
      expect(fs.existsSync(lib) ? fs.readdirSync(lib) : []).toEqual([])
    })

    it('refuse si la bibliothèque n’est pas configurée', async () => {
      const none = new ExportTemplateLibrary({ get: () => ({}) } as unknown as AppSettingsService)
      const r = await none.importFile('docx', upload('a.docx', DOCX), 'X.docx', false)
      expect(r.status).toBe('refused')
    })
  })

  describe('installExamples (AC9)', () => {
    it('ne réécrit jamais un exemple déjà présent (modifié par l’utilisateur)', async () => {
      const examples = path.join(tmp, 'exemples')
      fs.mkdirSync(examples)
      fs.writeFileSync(path.join(examples, 'Exemple.docx'), DOCX)
      await library.installExamples(examples)
      const target = path.join(lib, 'Exemples Polenta', 'Exemple.docx')
      fs.writeFileSync(target, 'modifié par l’utilisateur')
      const r = await library.installExamples(examples)
      expect(r.copied).toBe(0)
      expect(fs.readFileSync(target, 'utf8')).toBe('modifié par l’utilisateur')
    })
  })

  describe('deleteFile', () => {
    it('supprime le gabarit du disque', async () => {
      await library.importFile('docx', upload('a.docx', DOCX), 'Cahier.docx', false)
      expect(await library.deleteFile('Cahier.docx')).toEqual({ status: 'ok' })
      expect(fs.existsSync(path.join(lib, 'Cahier.docx'))).toBe(false)
    })

    it('refuse un chemin qui sort de la bibliothèque, sans rien supprimer', async () => {
      fs.mkdirSync(lib, { recursive: true })
      fs.writeFileSync(path.join(tmp, 'hors.docx'), 'x')
      const r = await library.deleteFile('../hors.docx')
      expect(r.status).toBe('refused')
      expect(fs.existsSync(path.join(tmp, 'hors.docx'))).toBe(true)
    })

    it('refuse un gabarit inexistant', async () => {
      fs.mkdirSync(lib, { recursive: true })
      const r = await library.deleteFile('absent.docx')
      expect(r.status).toBe('refused')
    })
  })
})
