import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type { GitService } from './git.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { LibraryModules } from './script-limits'
import { workspaceStamp } from './graph.service'

// GH74 — bibliothèque projet (`dashboards/lib/`) : modules JS importables par les scripts de
// données et les transformations de widget (specs/GH74.md §6, GH74-design.md §2.3).
// Clés d'import : `lib/<chemin>` pour le repo ouvert, `<composant>::lib/<chemin>` pour un repo
// composant du workspace (nom de montage).

export const LIBRARY_DIR = 'dashboards/lib'

export interface LoadedLibrary {
  modules: LibraryModules
  /** Empreinte de l'ensemble (clés + contenus) : change à toute modification d'un module. */
  hash: string
}

/** Un fichier de la bibliothèque de départ et ses versions livrées (`manifest.json`). */
export interface ShippedLibraryFile {
  /** Chemin relatif à `dashboards/lib/` (ex. `campaign.js`) ou à `dashboards/` (`jsconfig.json`). */
  path: string
  /** Emplacement dans le repo, relatif à sa racine. */
  repoPath: string
  id: string
  versions: { version: number; hash: string; summary: { fr: string; en: string } }[]
}

export interface ShippedManifest {
  files: ShippedLibraryFile[]
}

/** Fichier livré à proposer dans le bandeau (sans `fromVersion` : nouveau fichier). */
export interface LibraryUpdate {
  file: ShippedLibraryFile
  fromVersion?: number
  toVersion: number
  summary: { fr: string; en: string }
}

/** Empreinte d'un fichier : SHA-256 du contenu normalisé (fins de ligne LF, sans espaces de fin). */
export function contentHash(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n*$/, '\n')
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/** Dossier de la bibliothèque de départ livrée avec l'application (desktop, serveur web, MCP, tests). */
export function resolveShippedLibraryDir(): string {
  const candidates = [
    process.env.POLENTA_DASHBOARD_LIB,
    // Serveur MCP : copiée à côté du bundle.
    path.join(__dirname, 'dashboard-lib'),
    // Serveur web (image Docker) : /app/resources à côté de /app/web-server.
    path.resolve(__dirname, '../resources/dashboard-lib'),
    // Desktop packagé : extraResources.
    typeof process.resourcesPath === 'string' ? path.join(process.resourcesPath, 'dashboard-lib') : undefined,
    // Desktop en développement (out/main) et sources (vitest, tsx : src/main/services).
    path.resolve(__dirname, '../../resources/dashboard-lib'),
    path.resolve(__dirname, '../../../resources/dashboard-lib'),
  ]
  for (const c of candidates) if (c && fs.existsSync(path.join(c, 'manifest.json'))) return c
  throw new Error('Bibliothèque de départ introuvable (resources/dashboard-lib).')
}

export class DashboardLibraryService {
  private readonly cache = new Map<string, { promise: Promise<LoadedLibrary>; repoPaths: Set<string> }>()

  constructor(
    private readonly git: GitService,
    private readonly workspaceTree?: WorkspaceTreeService,
    private readonly shippedDir: () => string = resolveShippedLibraryDir,
  ) {}

  /** Modules du repo ouvert et des repos composants du workspace (en cache jusqu'à `invalidate` ou un
   *  changement de l'arbre du workspace). */
  async load(repoPath: string, workspaceDir?: string): Promise<LoadedLibrary> {
    const key = `${path.resolve(repoPath)}\u0000${workspaceDir ? path.resolve(workspaceDir) : ''}\u0000${await workspaceStamp(workspaceDir)}`
    const cached = this.cache.get(key)
    if (cached) return cached.promise
    const entry = { promise: Promise.resolve(null as unknown as LoadedLibrary), repoPaths: new Set<string>() }
    entry.promise = this.doLoad(repoPath, workspaceDir, entry.repoPaths).catch((err) => {
      if (this.cache.get(key) === entry) this.cache.delete(key)
      throw err
    })
    this.cache.set(key, entry)
    return entry.promise
  }

  /** Oublie les bibliothèques chargées qui incluent `repoPath`. */
  invalidate(repoPath: string): void {
    const target = path.resolve(repoPath)
    for (const [key, entry] of this.cache) {
      if (entry.repoPaths.size === 0 || entry.repoPaths.has(target)) this.cache.delete(key)
    }
  }

  /** Fichiers `.js` de `dashboards/lib/` d'un repo, par chemin relatif à `lib/` (tri stable). */
  async listModules(repoPath: string): Promise<{ path: string; source: string }[]> {
    const files = (await this.git.listFiles(repoPath, LIBRARY_DIR)).filter((f) => f.endsWith('.js')).sort()
    return Promise.all(files.map(async (f) => ({
      path: f.slice(LIBRARY_DIR.length + 1),
      source: await fs.promises.readFile(path.join(repoPath, f), 'utf8'),
    })))
  }

  /** Manifeste de la bibliothèque de départ (versions et empreintes livrées). */
  readShippedManifest(): ShippedManifest {
    return JSON.parse(fs.readFileSync(path.join(this.shippedDir(), 'manifest.json'), 'utf8')) as ShippedManifest
  }

  /** Contenu livré d'un fichier de la bibliothèque de départ (`path` du manifeste). */
  readShippedFile(file: string): string {
    return fs.readFileSync(path.join(this.shippedDir(), file), 'utf8')
  }

  /**
   * GH74 §6.2 — copie de la bibliothèque de départ, une seule fois par repo (`alreadySeeded` : chemins
   * du marqueur `dashboards/.seeded.yaml`) et seulement si `dashboards/lib/` est absent ; écriture
   * normale, à publier. Ensuite, un fichier supprimé par le projet n'est jamais recréé, et un fichier
   * livré par une version plus récente est proposé (`listLibraryUpdates`). Renvoie les chemins écrits.
   */
  async seedIfAbsent(repoPath: string, alreadySeeded: readonly string[], record: (files: string[]) => Promise<void>): Promise<string[]> {
    // Déjà copiée une fois : un fichier livré depuis est proposé dans le bandeau, jamais ajouté seul.
    if (alreadySeeded.length > 0) return []
    if ((await this.git.listFiles(repoPath, LIBRARY_DIR)).length > 0) return []
    const written: string[] = []
    try {
      for (const f of this.readShippedManifest().files) {
        if (await this.git.fileExists(repoPath, f.repoPath)) continue
        await this.git.writeText(repoPath, f.repoPath, this.readShippedFile(f.path))
        written.push(f.repoPath)
      }
    } finally {
      // Même interrompue, la copie note ce qu'elle a écrit (sinon `lib/` non vide bloquerait la
      // reprise et ces fichiers seraient reproposés comme nouveaux).
      if (written.length) {
        this.invalidate(repoPath)
        await record(written)
      }
    }
    return written
  }

  /**
   * GH74 §6.3 — fichiers livrés à proposer : présent dans le repo avec l'empreinte d'une version livrée
   * antérieure (mise à jour), ou absent et jamais copié (nouveau fichier livré). Fichier modifié par
   * le projet (empreinte inconnue) ou supprimé après copie : jamais proposé.
   */
  async listLibraryUpdates(repoPath: string, seeded: readonly string[]): Promise<LibraryUpdate[]> {
    const out: LibraryUpdate[] = []
    for (const f of this.readShippedManifest().files) {
      const latest = f.versions[f.versions.length - 1]
      const current = await fs.promises.readFile(path.join(repoPath, f.repoPath), 'utf8').catch(() => undefined)
      if (current === undefined) {
        if (!seeded.includes(f.repoPath)) out.push({ file: f, toVersion: latest.version, summary: latest.summary })
        continue
      }
      const hash = contentHash(current)
      const index = f.versions.findIndex((v) => v.hash === hash)
      if (index === -1 || index === f.versions.length - 1) continue
      out.push({ file: f, fromVersion: f.versions[index].version, toVersion: latest.version, summary: latest.summary })
    }
    return out
  }

  /** Écrit la version livrée d'un fichier du manifeste (application d'une mise à jour). */
  async writeShipped(repoPath: string, repoRelPath: string): Promise<void> {
    const f = this.readShippedManifest().files.find((x) => x.repoPath === repoRelPath)
    if (!f) throw new Error(`Fichier livré inconnu : ${repoRelPath}`)
    await this.git.writeText(repoPath, f.repoPath, this.readShippedFile(f.path))
    this.invalidate(repoPath)
  }

  private async doLoad(repoPath: string, workspaceDir: string | undefined, repoPaths: Set<string>): Promise<LoadedLibrary> {
    const own = path.resolve(repoPath)
    const repos: { prefix: string; repoPath: string }[] = [{ prefix: '', repoPath: own }]
    if (workspaceDir && this.workspaceTree) {
      const tree = await this.workspaceTree.readCache(workspaceDir)
      for (const node of tree?.nodes ?? []) {
        if (!node.repoPath || path.resolve(node.repoPath) === own) continue
        repos.push({ prefix: `${node.name}::`, repoPath: path.resolve(node.repoPath) })
      }
    }
    for (const r of repos) repoPaths.add(r.repoPath)
    const modules: LibraryModules = {}
    const lists = await Promise.all(repos.map(async (r) => ({ r, files: await this.listModules(r.repoPath) })))
    for (const { r, files } of lists) {
      for (const f of files) modules[`${r.prefix}lib/${f.path}`] = f.source
    }
    const h = crypto.createHash('sha256')
    for (const k of Object.keys(modules).sort()) h.update(k).update('\u0000').update(modules[k]).update('\u0000')
    return { modules, hash: h.digest('hex') }
  }
}
