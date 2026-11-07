import { DOMParser, type Element } from '@xmldom/xmldom'

/**
 * GH129 — lecture d'un rapport JUnit XML (specs/GH129.md §1) : pytest, JUnit/Surefire, Jest, e2Unit.
 * Pur : aucune lecture de fichier, aucune connaissance du projet Polenta.
 */

export type JunitVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED'

export interface JunitResult {
  file: string
  /** Nom de la `<testsuite>` englobante la plus proche ('' sans nom). */
  suite: string
  classname: string
  name: string
  verdict: JunitVerdict
  /** Message de `<failure>` / `<error>` (attribut puis texte), tronqué ; '' sinon. */
  message: string
  /** Secondes (attribut `time`), 0 si absent ou illisible. */
  duration: number
  /** ISO 8601 UTC, lu dans le `timestamp` de la suite la plus proche ; absent sinon. */
  executedAt?: string
  /** Valeurs des `<property name="requirement">` du testcase. */
  requirements: string[]
  /** Propriétés des suites englobantes (la plus proche l'emporte), dans l'ordre de lecture. */
  suiteProperties: Array<[string, string]>
}

export const JUNIT_MESSAGE_MAX = 2000

/** `classname.name`, ou `name` seul sans classname : identifiant affiché d'un résultat. */
export function junitKey(r: Pick<JunitResult, 'classname' | 'name'>): string {
  return r.classname ? `${r.classname}.${r.name}` : r.name
}

/** Date JUnit → ISO UTC ; sans fuseau, lue en UTC (spec §1.2). Illisible : undefined. */
export function parseJunitTimestamp(value: string | null | undefined): string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  // ISO local sans fuseau (pytest, e2Unit) → UTC ; toute autre forme est lue telle quelle.
  const zoned = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v
  const t = Date.parse(zoned)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

function childElements(el: Element, tag?: string): Element[] {
  const out: Element[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!tag || (n as Element).tagName === tag)) out.push(n as Element)
  }
  return out
}

function properties(el: Element): Array<[string, string]> {
  return childElements(el, 'properties').flatMap(p => childElements(p, 'property'))
    .map(p => [p.getAttribute('name') ?? '', p.getAttribute('value') ?? p.textContent ?? ''] as [string, string])
    .filter(([name]) => name !== '')
}

function truncate(text: string): string {
  const t = text.trim()
  return t.length > JUNIT_MESSAGE_MAX ? `${t.slice(0, JUNIT_MESSAGE_MAX - 1)}…` : t
}

function outcome(tc: Element): { verdict: JunitVerdict; message: string } {
  const failure = childElements(tc, 'failure')[0]
  const error = childElements(tc, 'error')[0]
  const node = failure ?? error
  if (node) {
    const attr = node.getAttribute('message')?.trim() ?? ''
    const text = node.textContent?.trim() ?? ''
    const message = attr && text && !text.startsWith(attr) ? `${attr}\n${text}` : (text || attr)
    return { verdict: failure ? 'FAIL' : 'BLOCKED', message: truncate(message) }
  }
  if (childElements(tc, 'skipped').length > 0) return { verdict: 'SKIPPED', message: '' }
  return { verdict: 'PASS', message: '' }
}

interface SuiteContext { suite: string; executedAt?: string; props: Array<[string, string]> }

function mergeProps(outer: Array<[string, string]>, inner: Array<[string, string]>): Array<[string, string]> {
  const names = new Set(inner.map(([n]) => n))
  return [...outer.filter(([n]) => !names.has(n)), ...inner]
}

function visit(el: Element, ctx: SuiteContext, file: string, out: JunitResult[]): void {
  if (el.tagName === 'testsuite' || el.tagName === 'testsuites') {
    const inner: SuiteContext = {
      suite: el.tagName === 'testsuite' ? (el.getAttribute('name') ?? '') : ctx.suite,
      executedAt: parseJunitTimestamp(el.getAttribute('timestamp')) ?? ctx.executedAt,
      props: mergeProps(ctx.props, properties(el)),
    }
    for (const child of childElements(el)) visit(child, inner, file, out)
  } else if (el.tagName === 'testcase') {
    const time = Number.parseFloat(el.getAttribute('time') ?? '')
    out.push({
      file,
      suite: ctx.suite,
      classname: el.getAttribute('classname') ?? '',
      name: el.getAttribute('name') ?? '',
      ...outcome(el),
      duration: Number.isFinite(time) && time > 0 ? time : 0,
      ...(ctx.executedAt && { executedAt: ctx.executedAt }),
      requirements: properties(el).filter(([n]) => n === 'requirement').map(([, v]) => v.trim()).filter(Boolean),
      suiteProperties: ctx.props,
    })
  }
}

/** Rapport → résultats, ou `fatal` (XML mal formé, racine inconnue). */
export function parseJunit(xml: string, file: string): JunitResult[] | { fatal: string } {
  let fatal: string | undefined
  let doc
  try {
    doc = new DOMParser({
      // `error` : xmldom a récupéré (ex. `&` non échappé dans un attribut) ; seul `fatalError` arrête.
      onError: (level: string, message: string) => {
        if (level === 'fatalError' && !fatal) fatal = message
      },
    }).parseFromString(xml.replace(/^\uFEFF/, ''), 'text/xml')
  } catch (err) {
    return { fatal: err instanceof Error ? err.message : String(err) }
  }
  if (fatal) return { fatal }
  const root = doc.documentElement
  if (!root || (root.tagName !== 'testsuites' && root.tagName !== 'testsuite')) {
    return { fatal: `root element <${root?.tagName ?? ''}> is not <testsuites> or <testsuite>` }
  }
  const out: JunitResult[] = []
  visit(root, { suite: '', props: [] }, file, out)
  return out
}
