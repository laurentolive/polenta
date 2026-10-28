/**
 * GH178 — diff mot à mot des vues de diff (mode Rendu) : LCS sur des jetons (mots, espaces,
 * ponctuation isolée), sur le modèle de `computeLineDiff`.
 */

const TOKEN_RE = /[\p{L}\p{N}_]+(?:['’.\-][\p{L}\p{N}_]+)*|\s+|[^\s\p{L}\p{N}_]/gu

/** Above this many tokens left to compare on one side, the whole middle is reported as changed
 *  (the DP table would be too large) — the unit stays marked, without word detail. */
export const MAX_DIFF_TOKENS = 2000

export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? []
}

export interface TokenDiff {
  /** `removed[i]` : jeton `i` de `a` absent de `b`. */
  removed: boolean[]
  /** `added[j]` : jeton `j` de `b` absent de `a`. */
  added: boolean[]
  /** `false` : garde-fou de taille atteint, tout le milieu est marqué sans détail. */
  detailed: boolean
}

export function diffTokens(a: string[], b: string[]): TokenDiff {
  const removed = new Array<boolean>(a.length).fill(false)
  const added = new Array<boolean>(b.length).fill(false)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }

  const m = endA - start
  const n = endB - start
  if (m > MAX_DIFF_TOKENS || n > MAX_DIFF_TOKENS) {
    for (let i = start; i < endA; i++) removed[i] = true
    for (let j = start; j < endB; j++) added[j] = true
    return { removed, added, detailed: false }
  }

  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[start + i] === b[start + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < m || j < n) {
    if (i < m && j < n && a[start + i] === b[start + j]) { i++; j++ }
    else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) { added[start + j] = true; j++ }
    else { removed[start + i] = true; i++ }
  }

  absorbSpaces(a, removed)
  absorbSpaces(b, added)
  return { removed, added, detailed: true }
}

/** A lone space kept between two changed words joins the change: « ~~a~~ ~~b~~ » reads as one
 *  change, not two speckles. */
function absorbSpaces(tokens: string[], changed: boolean[]): void {
  for (let i = 1; i < tokens.length - 1; i++) {
    if (!changed[i] && changed[i - 1] && changed[i + 1] && /^\s+$/.test(tokens[i])) changed[i] = true
  }
}

export interface Segment { text: string; changed: boolean }

/** Segments of `text` for one side of a plain-text diff (`side === 'before'` : mots retirés). */
export function wordSegments(text: string, other: string, side: 'before' | 'after'): Segment[] {
  const mine = tokenize(text)
  const theirs = tokenize(other)
  const d = side === 'before' ? diffTokens(mine, theirs) : diffTokens(theirs, mine)
  return toSegments(mine, side === 'before' ? d.removed : d.added)
}

export function toSegments(tokens: string[], changed: boolean[]): Segment[] {
  const out: Segment[] = []
  tokens.forEach((t, i) => {
    const last = out[out.length - 1]
    if (last && last.changed === changed[i]) last.text += t
    else out.push({ text: t, changed: changed[i] })
  })
  return out
}

// ─── Rendu richtext : marquage du DOM rendu ────────────────────────────────────────

const SKIP_CLASS = 'static-drawio'
const DIFF_ATTR = 'data-diff'

interface TokenRef { node: Text; start: number; end: number; text: string }

/** Text tokens of a rendered DOM, node by node (a token never spans two text nodes, so words of
 *  two paragraphs never merge). Diagrams are skipped. */
function domTokens(root: ParentNode): TokenRef[] {
  const doc = (root as Node).ownerDocument ?? document
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
        if (el.classList.contains(SKIP_CLASS)) return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const out: TokenRef[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? ''
    let pos = 0
    for (const t of tokenize(text)) {
      const start = text.indexOf(t, pos)
      out.push({ node: n as Text, start, end: start + t.length, text: t })
      pos = start + t.length
    }
  }
  return out
}

/** Removes the marks of a previous pass. */
export function clearWordDiff(root: HTMLElement): void {
  const marks = root.querySelectorAll(`[${DIFF_ATTR}]`)
  if (marks.length === 0) return
  for (const m of marks) m.replaceWith(document.createTextNode(m.textContent ?? ''))
  root.normalize()
}

/**
 * Marks in `root` (one side, rendered) the words that differ from `otherRoot` (the other side,
 * rendered the same way, inert): `<del class="diff-del">` on the Avant side, `<ins class="diff-ins">`
 * on the Après side. Returns the number of marks placed.
 */
export function applyWordDiff(root: HTMLElement, otherRoot: ParentNode, side: 'before' | 'after'): number {
  const mine = domTokens(root)
  const theirs = domTokens(otherRoot)
  const d = side === 'before'
    ? diffTokens(mine.map(t => t.text), theirs.map(t => t.text))
    : diffTokens(theirs.map(t => t.text), mine.map(t => t.text))
  const changed = side === 'before' ? d.removed : d.added

  // Changed ranges per text node, consecutive tokens merged.
  const ranges = new Map<Text, Array<[number, number]>>()
  mine.forEach((t, i) => {
    if (!changed[i] || !t.text.trim() && !(changed[i - 1] && changed[i + 1])) return
    const list = ranges.get(t.node) ?? []
    const last = list[list.length - 1]
    if (last && last[1] === t.start) last[1] = t.end
    else list.push([t.start, t.end])
    ranges.set(t.node, list)
  })

  let count = 0
  for (const [node, list] of ranges) {
    const text = node.nodeValue ?? ''
    const frag = document.createDocumentFragment()
    let pos = 0
    for (const [s, e] of list) {
      if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)))
      const mark = document.createElement(side === 'before' ? 'del' : 'ins')
      mark.className = side === 'before' ? 'diff-del' : 'diff-ins'
      mark.setAttribute(DIFF_ATTR, '')
      mark.textContent = text.slice(s, e)
      frag.appendChild(mark)
      pos = e
      count++
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)))
    node.parentNode?.replaceChild(frag, node)
  }
  return count
}

// ─── GH145 — diff mot à mot de deux textes (énoncé avant / après dans l'analyse d'impact) ───
// Plus longue sous-séquence commune sur les jetons « mot » et « espaces » : les espaces sont des
// jetons à part entière, le texte se reconstitue donc à l'identique par concaténation.

export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string }

/** Au-delà, la table LCS (n × m) coûterait trop : diff grossier « tout retiré / tout ajouté ». */
const MAX_CELLS = 250_000

function splitWords(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t !== '')
}

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = splitWords(before)
  const b = splitWords(after)
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }

  if (a.length * b.length > MAX_CELLS) {
    if (before) push('removed', before)
    if (after) push('added', after)
    return parts
  }

  // lcs[i][j] = longueur de la LCS de a[i..] et b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]!); i++; j++ }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { push('removed', a[i]!); i++ }
    else { push('added', b[j]!); j++ }
  }
  while (i < a.length) push('removed', a[i++]!)
  while (j < b.length) push('added', b[j++]!)
  return parts
}

/** Valeur d'un champ du diff (`changedFields[].from/to`) rendue en texte. */
export function diffValueText(v: unknown): string {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}
