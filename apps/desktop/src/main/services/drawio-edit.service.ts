import { createHash } from 'crypto'
import * as fsP from 'fs/promises'
import * as path from 'path'
import { parseDrawioPages } from '../drawio-xml'
import { isInside } from './diff-edit.service'

/**
 * GH46 — édition d'un diagramme `.drawio` depuis le client web (éditeur draw.io embarqué).
 *
 * Le fichier est lu et écrit dans le working tree, comme le fait l'éditeur externe du desktop : pas
 * de commit (D4). Confinement sur le modèle de `DiffEditService.saveWorkingFile` : le fichier doit
 * être sous `diagrams/` du repo, réel (`realpath`), et son contenu doit être celui qui a été ouvert
 * (SHA-256 de référence) : sinon `conflict`, rien n'est écrit.
 */

/** Dossier où vivent les diagrammes (`importFileIntoRepo`, `diagrams/`). */
const DIAGRAMS_DIR = 'diagrams'
/** Taille maximale d'un diagramme renvoyé par l'éditeur (garde-fou ; un XML plus gros est refusé). */
const MAX_XML_BYTES = 20 * 1024 * 1024

export type DrawioOpenResult =
  | { status: 'ok'; xml: string; baseHash: string }
  | { status: 'error'; message: string }

export type DrawioSaveResult =
  | { status: 'ok'; baseHash: string }
  | { status: 'conflict' }
  | { status: 'refused'; message: string }

type Resolved = { ok: true; abs: string } | { ok: false; message: string }

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Chemin relatif au repo → chemin réel d'un `.drawio` sous `diagrams/`, ou raison du refus.
 * Refus : chemin absolu ou remontant (`..`), mauvaise extension, hors `diagrams/`, lien qui sort du
 * repo, fichier absent.
 */
async function resolveDiagramFile(repoPath: string, relativePath: string): Promise<Resolved> {
  const rel = relativePath.replace(/\\/g, '/')
  if (rel === '' || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..')) {
    return { ok: false, message: 'Chemin de diagramme invalide.' }
  }
  if (!/\.drawio$/i.test(rel)) return { ok: false, message: 'Seuls les fichiers .drawio sont éditables.' }

  const root = path.resolve(repoPath)
  const abs = path.resolve(root, rel)
  if (!isInside(path.join(root, DIAGRAMS_DIR), abs)) {
    return { ok: false, message: 'Le diagramme doit être dans le dossier diagrams/ du repo.' }
  }

  // Suivre les liens : le fichier réel doit rester sous le dossier réel `diagrams/` du repo.
  const realDiagrams = await fsP.realpath(path.join(root, DIAGRAMS_DIR)).catch(() => null)
  const realFile = await fsP.realpath(abs).catch(() => null)
  if (!realDiagrams || !realFile) return { ok: false, message: 'Diagramme introuvable dans le repo.' }
  if (!isInside(realDiagrams, realFile)) return { ok: false, message: 'Le diagramme doit être dans le dossier diagrams/ du repo.' }

  return { ok: true, abs: realFile }
}

export class DrawioEditService {
  /** Contenu (XML) et empreinte du fichier, pour l'éditeur. */
  async open(repoPath: string, relativePath: string): Promise<DrawioOpenResult> {
    const target = await resolveDiagramFile(repoPath, relativePath)
    if (!target.ok) return { status: 'error', message: target.message }
    const bytes = await fsP.readFile(target.abs).catch(() => null)
    if (!bytes) return { status: 'error', message: 'Diagramme introuvable dans le repo.' }
    const xml = new TextDecoder().decode(bytes)
    if (parseDrawioPages(xml).length === 0) return { status: 'error', message: 'Aucune page draw.io trouvée dans ce fichier.' }
    return { status: 'ok', xml, baseHash: sha256(bytes) }
  }

  /**
   * Enregistre le XML de l'éditeur si le fichier n'a pas changé depuis l'ouverture (`baseHash`).
   * Écriture atomique (fichier temporaire puis renommage) : un lecteur ne voit jamais un fichier tronqué.
   */
  async save(repoPath: string, relativePath: string, xml: string, baseHash: string): Promise<DrawioSaveResult> {
    if (typeof xml !== 'string' || typeof baseHash !== 'string') return { status: 'refused', message: 'Requête invalide.' }
    if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) return { status: 'refused', message: 'Diagramme trop volumineux.' }
    if (parseDrawioPages(xml).length === 0) return { status: 'refused', message: 'XML draw.io invalide : rien n’a été enregistré.' }

    const target = await resolveDiagramFile(repoPath, relativePath)
    if (!target.ok) return { status: 'refused', message: target.message }

    const current = await fsP.readFile(target.abs).catch(() => null)
    if (!current) return { status: 'refused', message: 'Diagramme introuvable dans le repo.' }
    if (sha256(current) !== baseHash) return { status: 'conflict' }

    const content = Buffer.from(xml, 'utf8')
    const tmp = `${target.abs}.${process.pid}.${Date.now()}.tmp`
    try {
      await fsP.writeFile(tmp, content)
      await fsP.rename(tmp, target.abs)
    } catch {
      await fsP.rm(tmp, { force: true }).catch(() => undefined)
      return { status: 'refused', message: 'Impossible d’écrire le diagramme dans le repo.' }
    }
    return { status: 'ok', baseHash: sha256(content) }
  }
}
