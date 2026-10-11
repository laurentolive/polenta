import { randomUUID } from 'crypto'
import * as fsP from 'fs/promises'
import * as path from 'path'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Nom de fichier sûr à partir d'un nom fourni par le navigateur (pas de séparateur, pas de contrôle). */
export function safeFileName(name: string, fallback = 'fichier'): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 200)
  return cleaned || fallback
}

/**
 * GH44 — fichiers temporaires d'un utilisateur : uploads (images, diagrammes, classeurs
 * d'exécution) et exports à télécharger. Un fichier vit dans `<dir>/<uuid>/<nom>` : le nom
 * d'origine est conservé (aperçu du classeur, nom proposé au téléchargement) sans risque de
 * collision. Le dossier appartient à l'espace de l'utilisateur : un identifiant d'un autre
 * utilisateur n'y existe pas.
 */
export class FileStore {
  constructor(readonly dir: string, private readonly ttlMs: number) {}

  async create(name: string): Promise<{ id: string; filePath: string; fileName: string }> {
    const id = randomUUID()
    const fileName = safeFileName(name)
    await fsP.mkdir(path.join(this.dir, id), { recursive: true })
    return { id, filePath: path.join(this.dir, id, fileName), fileName }
  }

  async resolve(id: string): Promise<{ filePath: string; fileName: string } | null> {
    if (!ID_PATTERN.test(id)) return null
    try {
      const entries = await fsP.readdir(path.join(this.dir, id))
      const fileName = entries[0]
      if (!fileName) return null
      return { filePath: path.join(this.dir, id, fileName), fileName }
    } catch {
      return null
    }
  }

  async remove(id: string): Promise<void> {
    if (!ID_PATTERN.test(id)) return
    // Réessais : sous Windows, un fichier tout juste refermé peut encore être verrouillé (#50).
    await fsP.rm(path.join(this.dir, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }

  /** Supprime les entrées plus anciennes que la durée de vie. */
  async purge(now = Date.now()): Promise<void> {
    let entries: string[]
    try {
      entries = await fsP.readdir(this.dir)
    } catch {
      return
    }
    for (const id of entries) {
      if (!ID_PATTERN.test(id)) continue
      const stat = await fsP.stat(path.join(this.dir, id)).catch(() => null)
      if (stat && now - stat.mtimeMs > this.ttlMs) await this.remove(id)
    }
  }
}
