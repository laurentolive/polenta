import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'
import { DrawioEditService } from './drawio-edit.service'
import { parseDrawioPages } from '../drawio-xml'

/** GH46 — service d'édition des diagrammes : confinement, empreinte de base, écriture atomique. */

const sha = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex')

function diagram(id: string, name: string, label: string): string {
  return `<diagram id="${id}" name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"/></root></mxGraphModel></diagram>`
}
const ONE_PAGE = `<mxfile host="test">${diagram('p1', 'Page-1', 'Bloc A')}</mxfile>`
const TWO_PAGES = `<mxfile host="test">${diagram('p1', 'Page-1', 'Bloc A')}${diagram('p2', 'Page-2', 'Bloc B')}</mxfile>`

describe('GH46 — DrawioEditService', () => {
  let tmp: string
  let repo: string
  let svc: DrawioEditService

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh46-'))
    repo = path.join(tmp, 'repo')
    fs.mkdirSync(path.join(repo, 'diagrams'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'diagrams', 'gh46.drawio'), ONE_PAGE, 'utf8')
    svc = new DrawioEditService()
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const onDisk = (rel = 'diagrams/gh46.drawio') => fs.readFileSync(path.join(repo, rel), 'utf8')

  describe('open', () => {
    it('renvoie le XML et l’empreinte SHA-256 des octets lus', async () => {
      const r = await svc.open(repo, 'diagrams/gh46.drawio')
      expect(r).toEqual({ status: 'ok', xml: ONE_PAGE, baseHash: sha(ONE_PAGE) })
    })

    it('refuse un chemin qui remonte ou est absolu', async () => {
      expect((await svc.open(repo, '../repo/diagrams/gh46.drawio')).status).toBe('error')
      expect((await svc.open(repo, '/etc/passwd.drawio')).status).toBe('error')
      expect((await svc.open(repo, 'C:/x/y.drawio')).status).toBe('error')
    })

    it('refuse un fichier hors de diagrams/ et une extension autre que .drawio', async () => {
      fs.writeFileSync(path.join(repo, 'secret.drawio'), ONE_PAGE, 'utf8')
      expect((await svc.open(repo, 'secret.drawio')).status).toBe('error')
      fs.writeFileSync(path.join(repo, 'diagrams', 'note.txt'), ONE_PAGE, 'utf8')
      expect((await svc.open(repo, 'diagrams/note.txt')).status).toBe('error')
    })

    it('refuse un fichier absent', async () => {
      expect((await svc.open(repo, 'diagrams/absent.drawio')).status).toBe('error')
    })
  })

  describe('save', () => {
    it('réécrit le fichier et renvoie la nouvelle empreinte (deux pages conservées)', async () => {
      const { baseHash } = (await svc.open(repo, 'diagrams/gh46.drawio')) as { baseHash: string }
      const r = await svc.save(repo, 'diagrams/gh46.drawio', TWO_PAGES, baseHash)
      expect(r).toEqual({ status: 'ok', baseHash: sha(TWO_PAGES) })
      expect(onDisk()).toBe(TWO_PAGES)
      expect(parseDrawioPages(onDisk()).map(p => p.name)).toEqual(['Page-1', 'Page-2'])
    })

    it('ne laisse aucun fichier temporaire après écriture', async () => {
      const { baseHash } = (await svc.open(repo, 'diagrams/gh46.drawio')) as { baseHash: string }
      await svc.save(repo, 'diagrams/gh46.drawio', TWO_PAGES, baseHash)
      expect(fs.readdirSync(path.join(repo, 'diagrams'))).toEqual(['gh46.drawio'])
    })

    it('renvoie conflict si le fichier a changé depuis l’ouverture, sans rien écrire', async () => {
      const { baseHash } = (await svc.open(repo, 'diagrams/gh46.drawio')) as { baseHash: string }
      const tiers = `<mxfile host="tiers">${diagram('p1', 'Page-1', 'Modifié ailleurs')}</mxfile>`
      fs.writeFileSync(path.join(repo, 'diagrams', 'gh46.drawio'), tiers, 'utf8')
      const r = await svc.save(repo, 'diagrams/gh46.drawio', TWO_PAGES, baseHash)
      expect(r).toEqual({ status: 'conflict' })
      expect(onDisk()).toBe(tiers)
    })

    it('refuse un XML qui ne contient aucune page draw.io, sans rien écrire', async () => {
      const { baseHash } = (await svc.open(repo, 'diagrams/gh46.drawio')) as { baseHash: string }
      const r = await svc.save(repo, 'diagrams/gh46.drawio', '<pas-du-drawio/>', baseHash)
      expect(r.status).toBe('refused')
      expect(onDisk()).toBe(ONE_PAGE)
    })

    it('refuse un chemin hors diagrams/ même avec une empreinte valide', async () => {
      fs.writeFileSync(path.join(repo, 'secret.drawio'), ONE_PAGE, 'utf8')
      const r = await svc.save(repo, 'secret.drawio', TWO_PAGES, sha(ONE_PAGE))
      expect(r.status).toBe('refused')
      expect(fs.readFileSync(path.join(repo, 'secret.drawio'), 'utf8')).toBe(ONE_PAGE)
    })

    it('refuse un chemin qui remonte (..) même si la cible existe', async () => {
      const r = await svc.save(repo, 'diagrams/../diagrams/gh46.drawio', TWO_PAGES, sha(ONE_PAGE))
      expect(r.status).toBe('refused')
      expect(onDisk()).toBe(ONE_PAGE)
    })

    it('refuse un fichier absent', async () => {
      const r = await svc.save(repo, 'diagrams/absent.drawio', TWO_PAGES, sha(ONE_PAGE))
      expect(r.status).toBe('refused')
    })

    it('refuse une requête mal formée (xml ou empreinte non chaîne)', async () => {
      const r = await svc.save(repo, 'diagrams/gh46.drawio', 42 as unknown as string, sha(ONE_PAGE))
      expect(r.status).toBe('refused')
      expect(onDisk()).toBe(ONE_PAGE)
    })
  })
})
