import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import git, { TREE, type WalkerEntry } from 'isomorphic-git'
import {
  detectKind, isBinaryContent, mergeFile, parseObject, parseOutput, type MarkerLabels,
} from '@polenta/merge-core'
import type {
  MergeConflictKind, MergeFileDetail, MergeFileDraft, MergeFileEntry, MergeFileKind, MergeFinalizeResult,
  MergeOrigin, MergeSessionInfo, MergeSide, MergeValidation, MergeValidationIssue,
} from '@polenta/types'

import type { AuthService } from './auth.service'
import type { SchemaService } from './schema.service'
import type { SyncService } from './sync.service'
import { findObjectTypeDef } from './schema-lookup.util'
import { TOMBSTONES_DIR } from './id-counter.util'
import { isEarsCompliant, isFilled } from './maturity.util'

/**
 * GH37 — résolution des conflits de merge dans l'outil (specs/GH37-design.md §2.2, §4).
 *
 * Tout se passe sur les objets git : `git.merge` (abortOnConflict) n'a rien écrit dans le working
 * directory ni l'index, et cette session non plus — elle lit les trois versions des fichiers en
 * conflit et, à la finalisation, reconstruit elle-même l'arbre résultat puis crée le commit de
 * merge à deux parents. L'avancement (sortie de chaque fichier) est un brouillon JSON hors du
 * repo, `userData/merge-drafts/<id>.json`, l'id dérivant du repo et des deux commits : rouvrir le
 * même merge retrouve le brouillon, un merge dont une branche a bougé est une autre session.
 */

interface DraftFile {
  session: MergeSessionInfo
  files: Record<string, MergeFileDraft>
}

/** One path of the 3-way walk: the tree entries of each side (absent = undefined). */
interface Triple {
  left?: WalkerEntry
  base?: WalkerEntry
  right?: WalkerEntry
}

/** One entry of the result tree, at any depth (a whole subtree can be taken as is). */
interface ResultEntry {
  path: string
  oid: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
}

const TREE_MODE = '040000'
const modeString = (mode: number) => mode.toString(8).padStart(6, '0')

async function oidOf(e: WalkerEntry | undefined): Promise<string | undefined> {
  return e ? e.oid() : undefined
}

async function textOf(e: WalkerEntry | undefined): Promise<{ text: string | null; binary: boolean }> {
  if (!e) return { text: null, binary: false }
  const bytes = await e.content()
  if (!bytes) return { text: null, binary: false }
  if (isBinaryContent(bytes)) return { text: null, binary: true }
  return { text: Buffer.from(bytes).toString('utf8'), binary: false }
}

export class MergeResolutionService {
  private cache = new Map<string, DraftFile>()

  constructor(
    private readonly auth: AuthService,
    private readonly sync: SyncService,
    private readonly schema: SchemaService,
  ) {}

  // ─── Session ──────────────────────────────────────────────────────────────────

  async open(repoPath: string, leftRef: string, rightRef: string, origin: MergeOrigin): Promise<MergeSessionInfo> {
    const leftOid = await git.resolveRef({ fs, dir: repoPath, ref: leftRef })
    const rightOid = await git.resolveRef({ fs, dir: repoPath, ref: rightRef })
    const bases = await git.findMergeBase({ fs, dir: repoPath, oids: [leftOid, rightOid] })
    if (bases.length !== 1) throw new Error(`Cannot resolve this merge: ${bases.length} merge bases`)
    const baseOid = bases[0] as string

    const id = createHash('sha1').update(`${path.resolve(repoPath)}\0${leftOid}\0${rightOid}`).digest('hex')
    const existing = await this.load(id)
    if (existing) return existing.session

    const labels = { left: leftRef, right: rightRef }
    const files: MergeFileEntry[] = []
    await this.walk(repoPath, leftOid, baseOid, rightOid, async (filepath, t) => {
      const entry = await this.classify(filepath, t, labels)
      if (entry) files.push(entry)
    })
    files.sort((a, b) => a.path.localeCompare(b.path))

    // Publier (et le merge du graphe) avancent la branche de droite ; seule la reprise d'un pull
    // (sprint 3) avancera la gauche.
    const session: MergeSessionInfo = {
      id, repoPath, origin, leftRef, rightRef, leftOid, rightOid, baseOid,
      targetRef: rightRef, targetSide: 'right', files,
    }
    await this.store({ session, files: {} })
    return session
  }

  /** Resolutions in progress (drafts), optionally for the given repos only — lets the UI offer to
   *  resume one after the app restarted, when nothing else leads back to it. */
  async list(repoPaths?: string[]): Promise<MergeSessionInfo[]> {
    const dir = path.dirname(this.draftPath('x'))
    let names: string[]
    try {
      names = (await fsP.readdir(dir)).filter(n => n.endsWith('.json'))
    } catch {
      return []
    }
    const wanted = repoPaths && new Set(repoPaths.map(p => path.resolve(p)))
    const sessions: MergeSessionInfo[] = []
    for (const n of names) {
      const draft = await this.load(n.slice(0, -'.json'.length))
      if (!draft || (wanted && !wanted.has(path.resolve(draft.session.repoPath)))) continue
      // A draft whose branches moved since can never be finalized ("stale") — not offered.
      if (await this.isCurrent(draft.session)) sessions.push(draft.session)
    }
    return sessions
  }

  private async isCurrent(session: MergeSessionInfo): Promise<boolean> {
    const [l, r] = await Promise.all([
      git.resolveRef({ fs, dir: session.repoPath, ref: session.leftRef }).catch(() => null),
      git.resolveRef({ fs, dir: session.repoPath, ref: session.rightRef }).catch(() => null),
    ])
    return l === session.leftOid && r === session.rightOid
  }

  async get(id: string): Promise<MergeSessionInfo | null> {
    return (await this.load(id))?.session ?? null
  }

  async getFile(id: string, filepath: string): Promise<MergeFileDetail> {
    const draft = await this.require(id)
    const { session } = draft
    const entry = session.files.find(f => f.path === filepath)
    if (!entry) throw new Error(`${filepath} is not in conflict in this merge`)
    const [base, left, right] = await Promise.all([
      this.readText(session.repoPath, session.baseOid, filepath),
      this.readText(session.repoPath, session.leftOid, filepath),
      this.readText(session.repoPath, session.rightOid, filepath),
    ])
    const merge = entry.kind !== 'binary' && left !== null && right !== null
      ? mergeFile(base, left, right, this.labels(session))
      : null
    return {
      ...entry,
      base, left, right,
      initialOutput: merge?.output ?? null,
      blocks: merge?.blocks ?? [],
      auto: merge?.auto ?? [],
      draft: draft.files[filepath],
    }
  }

  async saveFile(id: string, filepath: string, fileDraft: MergeFileDraft): Promise<MergeSessionInfo> {
    const draft = await this.require(id)
    const entry = draft.session.files.find(f => f.path === filepath)
    if (!entry) throw new Error(`${filepath} is not in conflict in this merge`)
    draft.files[filepath] = fileDraft
    entry.state = fileDraft.state
    await this.store(draft)
    return draft.session
  }

  async validate(id: string, filepath: string, text: string): Promise<MergeValidation> {
    const { session } = await this.require(id)
    const entry = session.files.find(f => f.path === filepath)
    if (!entry) throw new Error(`${filepath} is not in conflict in this merge`)
    return this.validateText(session.repoPath, entry, text)
  }

  async abandon(id: string): Promise<void> {
    this.cache.delete(id)
    await fsP.rm(this.draftPath(id), { force: true })
  }

  // ─── Finalisation (design §4) ───────────────────────────────────────────────────

  async finalize(id: string): Promise<MergeFinalizeResult> {
    const draft = await this.require(id)
    const { session } = draft
    const { repoPath } = session

    // 1. Les deux branches n'ont pas bougé depuis l'ouverture.
    if (!(await this.isCurrent(session))) return { ok: false, reason: 'stale' }

    // 2. Branche cible checkoutée → le WD doit être propre (il sera réaligné par un checkout).
    //    Publier aussi : la suite (renderer) quitte la branche de travail pour l'intégration, ce
    //    qu'empêcherait une modification non commitée — refusé ici, avant tout commit.
    const current = await git.currentBranch({ fs, dir: repoPath })
    const targetCheckedOut = current === session.targetRef
    if (targetCheckedOut || session.origin.kind === 'publish') {
      const status = await this.sync.status(repoPath)
      if (status.staged.length + status.unstaged.length > 0) return { ok: false, reason: 'dirty-worktree' }
    }

    // 3. Chaque fichier en conflit est mergé, avec une sortie valide.
    const unresolved = session.files.filter(f => draft.files[f.path]?.state !== 'merged').map(f => f.path)
    if (unresolved.length > 0) return { ok: false, reason: 'unresolved', paths: unresolved }
    const invalid: string[] = []
    for (const f of session.files) {
      const d = draft.files[f.path]
      if (d.text !== undefined) {
        if ((await this.validateText(repoPath, f, d.text)).errors.length > 0) invalid.push(f.path)
      } else if (!d.choice) {
        invalid.push(f.path)
      }
    }
    if (invalid.length > 0) return { ok: false, reason: 'invalid', paths: invalid }

    // 4. Arbre résultat.
    const tree = await this.buildTree(session, draft.files)

    // 5. Commit de merge à deux parents sur la branche cible.
    const author = await this.auth.getAuthor(repoPath)
    const targetOid = session.targetSide === 'right' ? session.rightOid : session.leftOid
    const otherOid = session.targetSide === 'right' ? session.leftOid : session.rightOid
    const otherRef = session.targetSide === 'right' ? session.leftRef : session.rightRef
    const sha = await git.commit({
      fs,
      dir: repoPath,
      message: `Merge branch '${otherRef}' into ${session.targetRef}`,
      author: { name: author.name, email: author.email },
      tree,
      parent: [targetOid, otherOid],
      ref: `refs/heads/${session.targetRef}`,
    })

    // 6. Réaligne WD et index si la cible est la branche courante (vérifié propre en 2).
    if (targetCheckedOut) await git.checkout({ fs, dir: repoPath, ref: session.targetRef, force: true })

    // 7. Brouillon supprimé.
    await this.abandon(id)
    return { ok: true, sha, session }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────────

  private labels(session: MergeSessionInfo): MarkerLabels {
    return { left: session.leftRef, right: session.rightRef }
  }

  /**
   * Walks left/base/right together and calls `onBlob` for each path whose content differs on
   * both sides (the only paths that can conflict). Subtrees identical on two sides are pruned.
   */
  private async walk(
    repoPath: string, leftOid: string, baseOid: string, rightOid: string,
    onBlob: (filepath: string, t: Triple) => Promise<void>,
    opts: { onTaken?: (entry: ResultEntry) => void; mustDescend?: (filepath: string) => boolean } = {},
  ): Promise<void> {
    const { onTaken, mustDescend } = opts
    await git.walk({
      fs,
      dir: repoPath,
      trees: [TREE({ ref: leftOid }), TREE({ ref: baseOid }), TREE({ ref: rightOid })],
      map: async (filepath, entries) => {
        const [left, base, right] = (entries ?? []).map(e => e ?? undefined)
        if (filepath === '.') return true
        const [lo, bo, ro] = await Promise.all([oidOf(left), oidOf(base), oidOf(right)])
        // Same on both sides, or changed on one side only: taken as is (whole subtree if a tree).
        const taken = lo === ro ? left : lo === bo ? right : ro === bo ? left : null
        if (taken !== null) {
          const type = taken ? await taken.type() : undefined
          if (type === 'tree' && mustDescend?.(filepath)) return true
          if (taken && onTaken) {
            onTaken({
              path: filepath,
              oid: (await taken.oid()) as string,
              mode: type === 'tree' ? TREE_MODE : modeString(await taken.mode()),
              type: type as ResultEntry['type'],
            })
          }
          return null
        }
        const types = await Promise.all([left?.type(), right?.type()])
        if (types.every(t => t === undefined || t === 'tree')) return true
        if (types.includes('tree')) throw new Error(`Cannot resolve this merge: ${filepath} is a file on one side and a folder on the other`)
        await onBlob(filepath, { left, base, right })
        return null
      },
    })
  }

  /** Conflict entry for a path changed on both sides, or `null` when it merges cleanly. */
  private async classify(filepath: string, t: Triple, labels: MarkerLabels): Promise<MergeFileEntry | null> {
    const [base, left, right] = await Promise.all([textOf(t.base), textOf(t.left), textOf(t.right)])
    let conflict: MergeConflictKind
    if (!t.left) conflict = 'deleted-left'
    else if (!t.right) conflict = 'deleted-right'
    else conflict = t.base ? 'both-modified' : 'both-added'

    let kind: MergeFileKind
    if (left.binary || right.binary || base.binary) kind = 'binary'
    else kind = detectKind([left.text, right.text])

    if (kind !== 'binary' && left.text !== null && right.text !== null) {
      if (mergeFile(base.text, left.text, right.text, labels).blocks.length === 0) return null
    }

    const sample = parseObject(right.text ?? left.text ?? '')
    return {
      path: filepath,
      conflict,
      kind,
      ...(kind === 'object' && sample ? { objectId: sample.id as string, title: typeof sample.title === 'string' ? sample.title : undefined } : {}),
      state: 'todo',
    }
  }

  private async buildTree(session: MergeSessionInfo, files: Record<string, MergeFileDraft>): Promise<string> {
    const { repoPath } = session
    const conflicts = new Map(session.files.map(f => [f.path, f]))
    // An object deleted on one side but kept here must not be left with the tombstone the
    // deleting side wrote for it (GH20: a tombstone means "never issue this ID again").
    const dropTombstones = new Set(
      session.files
        .filter(f => (f.conflict === 'deleted-left' || f.conflict === 'deleted-right') && f.objectId)
        .filter(f => {
          const d = files[f.path]
          const deletedSide: MergeSide = f.conflict === 'deleted-left' ? 'left' : 'right'
          return d.text !== undefined || (d.choice !== undefined && d.choice !== deletedSide)
        })
        .map(f => `${TOMBSTONES_DIR}/${f.objectId}`),
    )
    const entries: ResultEntry[] = []

    await this.walk(
      repoPath, session.leftOid, session.baseOid, session.rightOid,
      async (filepath, t) => {
        const entry = conflicts.get(filepath)
        const modeFrom = async () => modeString(await (t.right ?? t.left)!.mode())
        if (!entry) {
          // Clean 3-way merge (not listed as a conflict): recompute it to get the content.
          const [base, left, right] = await Promise.all([textOf(t.base), textOf(t.left), textOf(t.right)])
          const merged = mergeFile(base.text, left.text!, right.text!, this.labels(session))
          entries.push({ path: filepath, oid: await this.writeBlob(repoPath, merged.output), mode: await modeFrom(), type: 'blob' })
          return
        }
        const d = files[filepath]
        if (d.text !== undefined) {
          entries.push({ path: filepath, oid: await this.writeBlob(repoPath, d.text), mode: await modeFrom(), type: 'blob' })
          return
        }
        const chosen = d.choice === 'left' ? t.left : t.right
        if (chosen) {
          entries.push({ path: filepath, oid: (await chosen.oid()) as string, mode: modeString(await chosen.mode()), type: 'blob' })
        }
      },
      {
        onTaken: e => { if (!dropTombstones.has(e.path)) entries.push(e) },
        // Never take a whole subtree that holds a tombstone to drop: walk into it instead.
        mustDescend: p => [...dropTombstones].some(d => d.startsWith(`${p}/`)),
      },
    )
    return this.writeTrees(repoPath, entries)
  }

  private async writeBlob(repoPath: string, text: string): Promise<string> {
    return git.writeBlob({ fs, dir: repoPath, blob: Buffer.from(text, 'utf8') })
  }

  /** Writes the nested trees of `entries` (any depth) bottom-up; empty folders vanish, the root stays. */
  private async writeTrees(repoPath: string, entries: ResultEntry[]): Promise<string> {
    interface Dir { dirs: Map<string, Dir>; items: { mode: string; path: string; oid: string; type: ResultEntry['type'] }[] }
    const root: Dir = { dirs: new Map(), items: [] }
    for (const e of entries) {
      const parts = e.path.split('/')
      let dir = root
      for (const part of parts.slice(0, -1)) {
        if (!dir.dirs.has(part)) dir.dirs.set(part, { dirs: new Map(), items: [] })
        dir = dir.dirs.get(part)!
      }
      dir.items.push({ mode: e.mode, path: parts[parts.length - 1], oid: e.oid, type: e.type })
    }
    const write = async (dir: Dir, isRoot: boolean): Promise<string | null> => {
      const items = [...dir.items]
      for (const [name, sub] of dir.dirs) {
        const oid = await write(sub, false)
        if (oid) items.push({ mode: TREE_MODE, path: name, oid, type: 'tree' })
      }
      if (items.length === 0 && !isRoot) return null
      return git.writeTree({ fs, dir: repoPath, tree: items })
    }
    return (await write(root, true))!
  }

  private async readText(repoPath: string, commitOid: string, filepath: string): Promise<string | null> {
    try {
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: commitOid, filepath })
      return isBinaryContent(blob) ? null : Buffer.from(blob).toString('utf8')
    } catch {
      return null
    }
  }

  private async validateText(repoPath: string, entry: MergeFileEntry, text: string): Promise<MergeValidation> {
    const errors: MergeValidationIssue[] = []
    const warnings: MergeValidationIssue[] = []
    const parsed = parseOutput(entry.kind, text)
    if (parsed.unresolved.length > 0) errors.push({ code: 'unresolved', params: { count: parsed.unresolved.length } })
    if (parsed.error) {
      errors.push({ code: 'yaml', params: { message: parsed.error } })
      return { errors, warnings }
    }
    if (entry.kind !== 'object' || parsed.unresolved.length > 0) return { errors, warnings }

    const obj = parsed.value!
    const expectedId = path.basename(entry.path).replace(/\.ya?ml$/, '')
    if (obj.id !== expectedId) errors.push({ code: 'idMismatch', params: { id: String(obj.id ?? ''), expected: expectedId } })
    if (typeof obj.title !== 'string' || obj.title.trim() === '') errors.push({ code: 'emptyTitle' })
    if (obj.fields !== undefined && obj.fields !== null && (typeof obj.fields !== 'object' || Array.isArray(obj.fields))) {
      errors.push({ code: 'fieldsNotObject' })
    }
    const ref = typeof obj.objectTypeRef === 'string' ? obj.objectTypeRef : ''
    const typeDef = findObjectTypeDef(await this.schema.get(repoPath), ref)
    if (typeDef === null) {
      errors.push({ code: 'unknownType', params: { ref } })
    } else if (typeDef !== 'unresolvable') {
      if (typeDef.statuses && typeDef.statuses.length > 0 && !typeDef.statuses.some(s => s.name === obj.status)) {
        errors.push({ code: 'unknownStatus', params: { status: String(obj.status ?? '') } })
      }
      // Non bloquant (sprint 2) : mêmes règles que l'import en masse et la maturité, signalées
      // sans empêcher « Merger » — un merge n'a pas à corriger ce que les deux côtés acceptaient.
      const fields = (obj.fields && typeof obj.fields === 'object' ? obj.fields : {}) as Record<string, unknown>
      for (const f of typeDef.fields ?? []) {
        const label = f.label ?? f.name
        if (f.required && !isFilled(fields[f.name])) warnings.push({ code: 'requiredEmpty', params: { field: label } })
        else if (f.validator === 'EARS' && isFilled(fields[f.name]) && !isEarsCompliant(fields[f.name])) {
          warnings.push({ code: 'ears', params: { field: label } })
        }
      }
    }
    return { errors, warnings }
  }

  // ─── Drafts (userData/merge-drafts) ─────────────────────────────────────────────

  private draftPath(id: string): string {
    return path.join(app.getPath('userData'), 'merge-drafts', `${id}.json`)
  }

  private async load(id: string): Promise<DraftFile | null> {
    const cached = this.cache.get(id)
    if (cached) return cached
    try {
      const draft = JSON.parse(await fsP.readFile(this.draftPath(id), 'utf-8')) as DraftFile
      this.cache.set(id, draft)
      return draft
    } catch {
      return null
    }
  }

  private async require(id: string): Promise<DraftFile> {
    const draft = await this.load(id)
    if (!draft) throw new Error('This conflict resolution no longer exists (finalized or abandoned)')
    return draft
  }

  /** Atomic write (temp file + rename): a crash mid-write never leaves a truncated draft. */
  private async store(draft: DraftFile): Promise<void> {
    this.cache.set(draft.session.id, draft)
    const file = this.draftPath(draft.session.id)
    await fsP.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await fsP.writeFile(tmp, JSON.stringify(draft), 'utf-8')
    await fsP.rename(tmp, file)
  }
}
