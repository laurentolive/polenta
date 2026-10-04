import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import git, { TREE, type WalkerEntry } from 'isomorphic-git'
import {
  detectKind, entriesOf, isBinaryContent, mergeFile, nextFreeId, parseObject, parseOutput, prefixOf,
  renumberPath, renumberText, shortRef, type MarkerLabels,
} from '@polenta/merge-core'
import type {
  MergeConflictKind, MergeFileDetail, MergeFileDraft, MergeFileEntry, MergeFileKind, MergeFinalizeResult,
  MergeKeepBothResult, MergeOrigin, MergeSessionInfo, MergeSide, MergeValidation, MergeValidationIssue,
} from '@polenta/types'

import type { AuthService } from './auth.service'
import type { SchemaService } from './schema.service'
import type { SyncService } from './sync.service'
import { findObjectTypeDef } from './schema-lookup.util'
import { TOMBSTONES_DIR } from './id-counter.util'
import { isEarsCompliant, isFilled } from './maturity.util'

/**
 * GH37 — résolution des conflits de merge dans l'outil (specs/GH37-design.md §2.2, §4, §5).
 *
 * Tout se passe sur les objets git : `git.merge` (abortOnConflict) n'a rien écrit dans le working
 * directory ni l'index, et cette session non plus — elle lit les trois versions des fichiers en
 * conflit et, à la finalisation, reconstruit elle-même l'arbre résultat puis crée le commit de
 * merge à deux parents. L'avancement (sortie de chaque fichier) est un brouillon JSON hors du
 * repo, `userData/merge-drafts/<id>.json`, l'id dérivant du repo et des deux commits : rouvrir le
 * même merge retrouve le brouillon ; si une branche a bougé, l'ancien brouillon est périmé et
 * remplacé par une session neuve (signalé à l'utilisateur).
 *
 * « Garder les deux » (sprint 3) réécrit le côté gauche dans un arbre git synthétique
 * (`leftTreeOid`) : l'objet ajouté des deux côtés n'existe pas dans l'ancêtre, donc toute
 * occurrence de son ID côté gauche désigne l'objet de gauche — chemins et contenus des fichiers
 * modifiés à gauche sont renumérotés, puis la session est recalculée sur (ancêtre, gauche', droite).
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
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
}

async function oidOf(e: WalkerEntry | undefined): Promise<string | undefined> {
  return e ? e.oid() : undefined
}

async function textOf(e: WalkerEntry | undefined): Promise<{ text: string | null; binary: boolean }> {
  if (!e) return { text: null, binary: false }
  // A submodule pin (gitlink) points to a commit of another repo: no content to read here — it is
  // resolved by choosing a side, like a binary.
  if ((await e.type()) === 'commit') return { text: null, binary: true }
  const bytes = await e.content()
  if (!bytes) return { text: null, binary: false }
  if (isBinaryContent(bytes)) return { text: null, binary: true }
  return { text: Buffer.from(bytes).toString('utf8'), binary: false }
}

/** Every ancestor folder of `p` (`a/b/c.yaml` → `a`, `a/b`). */
function ancestors(p: string): string[] {
  const parts = p.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
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
    if (existing) return this.withStale(existing.session)

    // Same merge (repo + refs) left in progress while a branch moved since: that draft can never
    // be finalized any more — replaced by this fresh session, and the user is told (GH37 §10).
    let replacedStaleDraft = false
    for (const other of await this.allDrafts()) {
      const s = other.session
      if (s.id !== id && path.resolve(s.repoPath) === path.resolve(repoPath) && s.leftRef === leftRef && s.rightRef === rightRef) {
        await this.abandon(s.id)
        replacedStaleDraft = true
      }
    }

    // Publier et le graphe avancent la droite (la destination) ; Rafraîchir avance la branche
    // locale (gauche) en y fusionnant la branche distante.
    const targetSide: MergeSide = origin.kind === 'pull' ? 'left' : 'right'
    const session: MergeSessionInfo = {
      id, repoPath, origin, leftRef, rightRef, leftOid, rightOid, baseOid,
      renumbers: [],
      targetRef: targetSide === 'left' ? leftRef : rightRef,
      targetSide,
      files: await this.computeConflicts(repoPath, leftOid, baseOid, rightOid, { left: leftRef, right: rightRef }),
      ...(replacedStaleDraft ? { replacedStaleDraft } : {}),
    }
    await this.store({ session, files: {} })
    return session
  }

  /** Resolutions in progress (drafts), optionally for the given repos only — lets the UI offer to
   *  resume one after the app restarted, when nothing else leads back to it. Stale ones included
   *  (flagged): resuming one is how the user learns it must be started over. */
  async list(repoPaths?: string[]): Promise<MergeSessionInfo[]> {
    const wanted = repoPaths && new Set(repoPaths.map(p => path.resolve(p)))
    const sessions: MergeSessionInfo[] = []
    for (const draft of await this.allDrafts()) {
      if (wanted && !wanted.has(path.resolve(draft.session.repoPath))) continue
      sessions.push(await this.withStale(draft.session))
    }
    // Current ones first: "Reprendre" opens the first.
    return sessions.sort((a, b) => Number(!!a.stale) - Number(!!b.stale))
  }

  async get(id: string): Promise<MergeSessionInfo | null> {
    const draft = await this.load(id)
    return draft ? this.withStale(draft.session) : null
  }

  async getFile(id: string, filepath: string): Promise<MergeFileDetail> {
    const draft = await this.require(id)
    const { session } = draft
    const entry = session.files.find(f => f.path === filepath)
    if (!entry) throw new Error(`${filepath} is not in conflict in this merge`)
    const { repoPath } = session
    const leftRoot = session.leftTreeOid ?? session.leftOid
    const [base, left, right] = await Promise.all([
      this.readText(repoPath, session.baseOid, filepath),
      this.readText(repoPath, leftRoot, filepath),
      this.readText(repoPath, session.rightOid, filepath),
    ])
    let images: MergeFileDetail['images']
    const mime = IMAGE_TYPES[path.extname(filepath).slice(1).toLowerCase()]
    if (entry.kind === 'binary' && mime) {
      const [b, l, r] = await Promise.all([
        this.readDataUrl(repoPath, session.baseOid, filepath, mime),
        this.readDataUrl(repoPath, leftRoot, filepath, mime),
        this.readDataUrl(repoPath, session.rightOid, filepath, mime),
      ])
      images = { ...(b ? { base: b } : {}), ...(l ? { left: l } : {}), ...(r ? { right: r } : {}) }
    }
    const merge = entry.kind !== 'binary' && left !== null && right !== null
      ? mergeFile(base, left, right, this.labels(session), filepath)
      : null
    // A file brought in by the renumbering exists on one side only: its output is that content.
    const initialOutput = merge?.output ?? (entry.conflict === 'renumbered' ? left ?? right : null)
    return {
      ...entry,
      base, left, right,
      ...(images ? { images } : {}),
      initialOutput,
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
    // The "stale draft replaced" notice has been seen once the user works on the session.
    delete draft.session.replacedStaleDraft
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

  // ─── « Garder les deux » (design §5) ────────────────────────────────────────────

  /**
   * Object added on both sides with the same ID: the left one gets the next free ID of its
   * prefix, and every occurrence of the old ID on the left side follows. `apply: false` only
   * previews (ID + files rewritten); `apply: true` also recomputes the session — drafts of the
   * files not touched by the renumbering are kept.
   */
  async keepBoth(id: string, filepath: string, apply: boolean): Promise<MergeKeepBothResult> {
    const draft = await this.require(id)
    const { session } = draft
    const entry = session.files.find(f => f.path === filepath)
    if (!entry || entry.conflict !== 'both-added' || entry.kind !== 'object' || !entry.objectId) {
      throw new Error(`${filepath} is not an object added on both sides`)
    }
    const oldId = entry.objectId
    const prefix = prefixOf(oldId)
    if (!prefix) throw new Error(`${oldId} has no numeric suffix`)

    const { repoPath } = session
    const known = new Set<string>()
    for (const ref of [session.baseOid, session.leftOid, session.rightOid]) {
      for (const f of await git.listFiles({ fs, dir: repoPath, ref })) known.add(f)
    }
    const newId = nextFreeId(prefix, known, session.renumbers.map(r => r.newId))

    const leftRoot = session.leftTreeOid ?? session.leftOid
    const { treeOid, impacted } = await this.rewriteLeft(repoPath, leftRoot, session.baseOid, oldId, newId)
    if (!apply) return { oldId, newId, impacted }

    const labels = this.labels(session)
    const conflicts = await this.computeConflicts(repoPath, treeOid, session.baseOid, session.rightOid, labels)
    const impactedSet = new Set(impacted)
    // Files touched by the renumbering but merging cleanly are listed for review ("renumbered").
    for (const p of impacted) {
      if (conflicts.some(c => c.path === p)) continue
      const text = await this.readText(repoPath, treeOid, p)
      // A binary file is only renamed (its content can't hold the ID): nothing to review.
      if (text === null) continue
      const sample = parseObject(text)
      conflicts.push({
        path: p,
        conflict: 'renumbered',
        kind: detectKind([text], p),
        ...(sample ? { objectId: sample.id as string, title: typeof sample.title === 'string' ? sample.title : undefined } : {}),
        state: 'todo',
      })
    }
    // Files listed for review by an earlier "Garder les deux" and untouched by this one stay
    // listed (with their draft, kept below) — otherwise their reviewed output would be dropped.
    for (const f of session.files) {
      if (f.conflict === 'renumbered' && !impactedSet.has(f.path) && !conflicts.some(c => c.path === f.path)) {
        conflicts.push({ ...f })
      }
    }
    conflicts.sort((a, b) => a.path.localeCompare(b.path))

    const files: Record<string, MergeFileDraft> = {}
    for (const f of conflicts) {
      const previous = draft.files[f.path]
      if (previous && !impactedSet.has(f.path) && f.path !== filepath) {
        files[f.path] = previous
        f.state = previous.state
      }
    }
    draft.session = {
      ...session,
      leftTreeOid: treeOid,
      renumbers: [...session.renumbers, { oldId, newId }],
      files: conflicts,
    }
    draft.files = files
    await this.store(draft)
    return { oldId, newId, impacted, session: draft.session }
  }

  /** Left side with `oldId` renumbered: changed paths/contents (vs the base) rewritten, the rest
   *  taken as is. Returns the new root tree and the rewritten paths (new names). */
  private async rewriteLeft(
    repoPath: string, leftRoot: string, baseOid: string, oldId: string, newId: string,
  ): Promise<{ treeOid: string; impacted: string[] }> {
    const entries: ResultEntry[] = []
    const impacted: string[] = []
    await git.walk({
      fs,
      dir: repoPath,
      trees: [TREE({ ref: leftRoot }), TREE({ ref: baseOid })],
      map: async (filepath, walkEntries) => {
        const [left, base] = (walkEntries ?? []).map(e => e ?? undefined)
        if (filepath === '.') return true
        if (!left) return null
        const [lo, bo] = await Promise.all([oidOf(left), oidOf(base)])
        const type = await left.type()
        if (lo === bo) {
          // Unchanged since the base: the ID (new on both sides) cannot appear in it.
          entries.push({ path: filepath, oid: lo as string, mode: type === 'tree' ? TREE_MODE : modeString(await left.mode()), type: type as ResultEntry['type'] })
          return null
        }
        if (type === 'tree') return true
        if (type === 'commit') {
          // Submodule pin: a commit of another repo, never read — copied as is.
          entries.push({ path: filepath, oid: lo as string, mode: modeString(await left.mode()), type: 'commit' })
          return null
        }
        const newPath = renumberPath(filepath, oldId, newId)
        const bytes = (await left.content()) ?? new Uint8Array()
        let oid = lo as string
        if (!isBinaryContent(bytes)) {
          const text = Buffer.from(bytes).toString('utf8')
          const rewritten = renumberText(text, oldId, newId)
          if (rewritten !== text) oid = await this.writeBlob(repoPath, rewritten)
        }
        if (oid !== lo || newPath !== filepath) impacted.push(newPath)
        entries.push({ path: newPath, oid, mode: modeString(await left.mode()), type: 'blob' })
        return null
      },
    })
    return { treeOid: await this.writeTrees(repoPath, entries), impacted: impacted.sort() }
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
    const message = session.origin.kind === 'pull'
      ? `Merge remote-tracking branch '${shortRef(session.origin.remoteRef)}' into ${session.targetRef}`
      : `Merge branch '${otherRef}' into ${session.targetRef}`
    const sha = await git.commit({
      fs,
      dir: repoPath,
      message,
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
    return { left: shortRef(session.leftRef), right: shortRef(session.rightRef) }
  }

  private async isCurrent(session: MergeSessionInfo): Promise<boolean> {
    const [l, r] = await Promise.all([
      git.resolveRef({ fs, dir: session.repoPath, ref: session.leftRef }).catch(() => null),
      git.resolveRef({ fs, dir: session.repoPath, ref: session.rightRef }).catch(() => null),
    ])
    return l === session.leftOid && r === session.rightOid
  }

  private async withStale(session: MergeSessionInfo): Promise<MergeSessionInfo> {
    const stale = !(await this.isCurrent(session))
    return stale ? { ...session, stale } : session
  }

  private async computeConflicts(
    repoPath: string, leftRoot: string, baseOid: string, rightOid: string, labels: MarkerLabels,
  ): Promise<MergeFileEntry[]> {
    const files: MergeFileEntry[] = []
    await this.walk(repoPath, leftRoot, baseOid, rightOid, async (filepath, t) => {
      const entry = await this.classify(filepath, t, labels)
      if (entry) files.push(entry)
    })
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  /**
   * Walks left/base/right together and calls `onBlob` for each path whose content differs on
   * both sides (the only paths that can conflict). Subtrees identical on two sides are pruned.
   * `leftRoot` may be a commit or a tree (the renumbered left side).
   */
  private async walk(
    repoPath: string, leftRoot: string, baseOid: string, rightOid: string,
    onBlob: (filepath: string, t: Triple) => Promise<void>,
    opts: {
      onTaken?: (entry: ResultEntry, taken: WalkerEntry) => Promise<void> | void
      mustDescend?: (filepath: string) => boolean
    } = {},
  ): Promise<void> {
    const { onTaken, mustDescend } = opts
    await git.walk({
      fs,
      dir: repoPath,
      trees: [TREE({ ref: leftRoot }), TREE({ ref: baseOid }), TREE({ ref: rightOid })],
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
            await onTaken({
              path: filepath,
              oid: (await taken.oid()) as string,
              mode: type === 'tree' ? TREE_MODE : modeString(await taken.mode()),
              type: type as ResultEntry['type'],
            }, taken)
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
    else kind = detectKind([left.text, right.text], filepath)

    if (kind !== 'binary' && left.text !== null && right.text !== null) {
      if (mergeFile(base.text, left.text, right.text, labels, filepath).blocks.length === 0) return null
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
    const leftRoot = session.leftTreeOid ?? session.leftOid
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
    // Folders holding a path that needs a decision of its own (tombstone to drop, renumbered file
    // with a reviewed output) are walked into rather than taken whole.
    const descend = new Set([...dropTombstones, ...session.files.map(f => f.path)].flatMap(ancestors))
    const entries: ResultEntry[] = []

    await this.walk(
      repoPath, leftRoot, session.baseOid, session.rightOid,
      async (filepath, t) => {
        const entry = conflicts.get(filepath)
        const modeFrom = async () => modeString(await (t.right ?? t.left)!.mode())
        if (!entry) {
          // Clean 3-way merge (not listed as a conflict): recompute it to get the content.
          const [base, left, right] = await Promise.all([textOf(t.base), textOf(t.left), textOf(t.right)])
          const merged = mergeFile(base.text, left.text!, right.text!, this.labels(session), filepath)
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
          // `commit` for a submodule pin (gitlink), `blob` otherwise.
          const type = (await chosen.type()) as ResultEntry['type']
          entries.push({ path: filepath, oid: (await chosen.oid()) as string, mode: modeString(await chosen.mode()), type })
        }
      },
      {
        onTaken: async (e, taken) => {
          if (dropTombstones.has(e.path)) return
          // A renumbered file present on one side only is "taken" by the walk: its reviewed
          // output (the draft) is what lands in the result.
          const d = e.type === 'blob' && conflicts.has(e.path) ? files[e.path] : undefined
          if (d?.text !== undefined) {
            entries.push({ ...e, oid: await this.writeBlob(repoPath, d.text), mode: modeString(await taken.mode()) })
            return
          }
          entries.push(e)
        },
        mustDescend: p => descend.has(p),
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

  private async readBytes(repoPath: string, rootOid: string, filepath: string): Promise<Uint8Array | null> {
    try {
      return (await git.readBlob({ fs, dir: repoPath, oid: rootOid, filepath })).blob
    } catch {
      return null
    }
  }

  private async readText(repoPath: string, rootOid: string, filepath: string): Promise<string | null> {
    const blob = await this.readBytes(repoPath, rootOid, filepath)
    return blob === null || isBinaryContent(blob) ? null : Buffer.from(blob).toString('utf8')
  }

  private async readDataUrl(repoPath: string, rootOid: string, filepath: string, mime: string): Promise<string | null> {
    const blob = await this.readBytes(repoPath, rootOid, filepath)
    return blob === null ? null : `data:${mime};base64,${Buffer.from(blob).toString('base64')}`
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
    if (parsed.unresolved.length > 0) return { errors, warnings }

    if (entry.kind === 'links' || entry.kind === 'parameters') {
      const root = parsed.value![entry.kind]
      const entries = entriesOf(entry.kind, root)
      if (!entries || Object.keys(parsed.value!).some(k => k !== entry.kind)) {
        errors.push({ code: entry.kind === 'links' ? 'invalidLinks' : 'invalidParameters' })
      } else if (entry.kind === 'links') {
        const bad = [...entries.values()].find(l => {
          const link = l as Record<string, unknown>
          return ['type', 'sourceId', 'targetId'].some(k => typeof link[k] !== 'string' || link[k] === '')
        }) as { id?: string } | undefined
        if (bad) errors.push({ code: 'invalidLinks', params: { id: bad.id ?? '' } })
      }
      return { errors, warnings }
    }
    if (entry.kind !== 'object') return { errors, warnings }

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

  private draftDir(): string {
    return path.join(app.getPath('userData'), 'merge-drafts')
  }

  private draftPath(id: string): string {
    return path.join(this.draftDir(), `${id}.json`)
  }

  private async allDrafts(): Promise<DraftFile[]> {
    let names: string[]
    try {
      names = (await fsP.readdir(this.draftDir())).filter(n => n.endsWith('.json'))
    } catch {
      return []
    }
    const drafts: DraftFile[] = []
    for (const n of names) {
      const d = await this.load(n.slice(0, -'.json'.length))
      if (d) drafts.push(d)
    }
    return drafts
  }

  private async load(id: string): Promise<DraftFile | null> {
    const cached = this.cache.get(id)
    if (cached) return cached
    try {
      const draft = JSON.parse(await fsP.readFile(this.draftPath(id), 'utf-8')) as DraftFile
      // Drafts written by sprint 1/2 predate `renumbers`.
      draft.session.renumbers ??= []
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
